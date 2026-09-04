// middleware/security.ts — §6.3 CSRF 三重 + §6.5 安全標頭 + §6.4 IP 速率限制。

import type { Context, Next } from 'hono';

// Cloudflare Rate Limiting binding 的執行期介面；@cloudflare/workers-types 目前版本還沒收錄，手動宣告。
interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

// §6.4：discord_id 限流另外掛在建企劃／加入／發起牽線（DISCORD_RATE_LIMITER，見 index.ts）；
// 這裡是全站 IP 節流，所有 mutation 共用，先擋住腳本濫用，不影響正常使用者手速。
export async function rateLimitGuard(c: Context<{ Bindings: { RATE_LIMITER: RateLimit } }>, next: Next) {
  const method = c.req.method;
  if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
    const { success } = await c.env.RATE_LIMITER.limit({ key: ip });
    if (!success) {
      console.warn(`rate limit exceeded: ip=${ip} path=${c.req.path}`);
      return c.json({ error: '操作太頻繁，請稍後再試' }, 429);
    }
  }
  await next();
}

// §6.3 CSRF 三重：
//   1. Cookie SameSite=Lax（跨站 POST 不帶 cookie）
//   2. Origin 檢查（缺 Origin 也拒絕）
//   3. 自訂標頭 X-KG: 1（瀏覽器跨站表單無法附加自訂標頭）
// 三個都過才放行 mutation。
export async function csrfGuard(c: Context, next: Next) {
  const method = c.req.method;
  if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
    if (c.req.header('X-KG') !== '1') {
      return c.json({ error: '缺少必要標頭' }, 403);
    }
    const origin = c.req.header('Origin');
    if (!origin) {
      return c.json({ error: '缺少 Origin' }, 403);
    }
    const host = new URL(c.req.url).host;
    let originHost = '';
    try { originHost = new URL(origin).host; } catch { /* 拒絕 */ }
    if (originHost !== host) {
      return c.json({ error: 'Origin 不符' }, 403);
    }
  }
  await next();
}

// §6.5 安全標頭。注意：handler 若回傳新建 Response（ASSETS 代理等），
// c.header() 會被覆蓋，所以這裡在 next() 之後重建 response，保證標頭一定在。
export async function securityHeaders(c: Context, next: Next) {
  await next();
  const res = c.res;
  const headers = new Headers(res.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  // script-src 不放 'unsafe-inline'：OG 頁的跳轉用 <meta refresh> 而非 inline script
  // frame-src 含 youtube.com／drive.google.com：對應前端 videoEmbedUrl() 的嵌入白名單，兩邊要一致
  headers.set(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: https:; media-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; frame-src https://www.youtube.com https://drive.google.com; connect-src 'self'",
  );
  c.res = new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
