// 公開網頁標題預覽（給連結晶片當預設顯示名稱）。只抓 og:title / title，有逾時與 SSRF 擋私人網段。

function decodeEntities(s: string) {
  return s
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function pickMeta(html: string): string {
  const og =
    html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["'][^>]*>/i);
  if (og?.[1]) return decodeEntities(og[1]);
  const tw =
    html.match(/<meta[^>]+name=["']twitter:title["'][^>]*content=["']([^"']+)["'][^>]*>/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']twitter:title["'][^>]*>/i);
  if (tw?.[1]) return decodeEntities(tw[1]);
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (title?.[1]) return decodeEntities(title[1]).trim();
  return '';
}

function isPublicHttpUrl(u: URL) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (/^(127\.|10\.|192\.168\.|0\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return false;
  if (host === '::1' || host.startsWith('[')) return false;
  return true;
}

export async function fetchPageTitle(raw: string): Promise<{ title: string }> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { title: '' };
  }
  if (!isPublicHttpUrl(parsed)) return { title: '' };
  try {
    const res = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (compatible; QianguanPreview/1.0)',
      },
      signal: AbortSignal.timeout(5000),
    });
    const ctype = res.headers.get('content-type') ?? '';
    if (!res.ok || !ctype.includes('html')) return { title: '' };
    const buf = await res.arrayBuffer();
    const html = new TextDecoder('utf-8').decode(buf.slice(0, 120_000));
    return { title: pickMeta(html).slice(0, 200) };
  } catch {
    return { title: '' };
  }
}
