// Cookie 簽發 — 規格「Discord 唯一身分」§Cookie 屬性
// kg_session：全站單一 session cookie。Path=/api 意味著 /dashboard 等非 API 路徑
// 永遠拿不到這個 cookie，伺服器端無法對這些路徑做登入檢查/轉址，只能前端掛載後呼叫
// GET /api/me 做客戶端轉址（見 index.ts 的路由與前端 Dashboard 頁）。

export const SESSION_COOKIE = 'kg_session';
export const COOKIE_MAX_AGE = 15552000; // 180 天

export function sessionCookieLine(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=${COOKIE_MAX_AGE}`;
}

export function sessionCookieClear(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=0`;
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
