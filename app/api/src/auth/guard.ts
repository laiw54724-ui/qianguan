// Cookie 簽發與權杖守衛 — 規格 §4.2
// kg_c_<projectId> / kg_o_<projectId>：HttpOnly; Secure; SameSite=Lax; Path=/api/p/<slug>
// （Path 對齊 API 前綴而非 /p/，瀏覽器才會把 cookie 送到 /api/p/<slug>/* 的請求）
// kg_c_ 可裝多個角色權杖（以 . 連接）——一個企劃裡一人多 OC 是常態，覆寫會弄丟前一隻。
import { sha256hex } from './token';

export const COOKIE_MAX_AGE = 15552000; // 180 天

function cookieLine(name: string, value: string, slug: string): string {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/api/p/${slug}; Max-Age=${COOKIE_MAX_AGE}`;
}

/** 從 Cookie header 字串讀指定名稱 */
export function readCookieFrom(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/** 角色 cookie 裡的所有權杖（多 OC） */
export function charTokens(cookieHeader: string | undefined, projectId: string): string[] {
  const v = readCookieFrom(cookieHeader, `kg_c_${projectId}`);
  return v ? v.split('.').filter(Boolean) : [];
}

export function ownerToken(cookieHeader: string | undefined, projectId: string): string | null {
  return readCookieFrom(cookieHeader, `kg_o_${projectId}`);
}

/** 產生角色 cookie（把新權杖併進既有清單，不覆寫） */
export function charCookieLine(
  slug: string,
  projectId: string,
  cookieHeader: string | undefined,
  newToken: string,
): string {
  const tokens = [...charTokens(cookieHeader, projectId), newToken];
  return cookieLine(`kg_c_${projectId}`, tokens.join('.'), slug);
}

export function ownerCookieLine(slug: string, projectId: string, token: string): string {
  return cookieLine(`kg_o_${projectId}`, token, slug);
}

/** 1-4「重看編輯碼」：把 oldToken 從清單換成 newToken，不是單純 append——
 * 否則舊碼還留在清單裡繼續有效，失去「重新產生就讓舊碼失效」的意義。 */
export function charCookieLineRotate(
  slug: string,
  projectId: string,
  cookieHeader: string | undefined,
  oldToken: string,
  newToken: string,
): string {
  const tokens = charTokens(cookieHeader, projectId).filter((t) => t !== oldToken);
  tokens.push(newToken);
  return cookieLine(`kg_c_${projectId}`, tokens.join('.'), slug);
}

/**
 * 取權杖：body.token（貼碼救援）優先，其次 cookie；回傳是否該順手種 cookie。
 * 雜湊比對（SHA-256 hex），無時序攻擊價值，不需要 constant-time。
 */
export async function resolveToken(
  cookieHeader: string | undefined,
  projectId: string,
  kind: 'c' | 'o',
  bodyToken: string | undefined,
  expectedHash: string,
): Promise<{ ok: boolean; plant: boolean }> {
  const candidates: { token: string; plant: boolean }[] = [];
  if (bodyToken?.trim()) candidates.push({ token: bodyToken.trim(), plant: true });
  if (kind === 'o') {
    const t = ownerToken(cookieHeader, projectId);
    if (t) candidates.push({ token: t, plant: false });
  } else {
    for (const t of charTokens(cookieHeader, projectId)) candidates.push({ token: t, plant: false });
  }
  for (const cand of candidates) {
    if ((await sha256hex(cand.token)) === expectedHash) {
      return { ok: true, plant: cand.plant };
    }
  }
  return { ok: false, plant: false };
}

