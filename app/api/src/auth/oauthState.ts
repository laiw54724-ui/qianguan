// auth/oauthState.ts — 登入用的一次性 state（KV）。
// 讀一次就刪；5 分鐘沒用到就自然過期。callback 只信任這裡存的 next，不信任 query string。
//
// redirectUri 也存在這裡，不要在 callback 重新用 new URL(..., c.req.url) 算一次——
// Discord OAuth2 規定 token 交換時送的 redirect_uri 要跟 /authorize 那次「逐字元相同」，
// 兩個獨立請求各自重算一次，只要中間有任何環境差異（不同網域同時服務、代理層 headers
// 正規化不一致等）就可能兜不起來，Discord 會直接讓 token 交換失敗且不解釋，前端只會看到
// 「按了登入、Discord 同意了、跳回來卻還是沒登入」——存下來一次，兩邊都讀同一個值最穩。
const TTL_SECONDS = 300;

export async function createState(kv: KVNamespace, next: string, redirectUri: string): Promise<string> {
  const id = crypto.randomUUID();
  await kv.put(`oauth:${id}`, JSON.stringify({ next, redirectUri }), { expirationTtl: TTL_SECONDS });
  return id;
}

export async function consumeState(kv: KVNamespace, stateId: string): Promise<{ next: string; redirectUri: string } | null> {
  const key = `oauth:${stateId}`;
  const raw = await kv.get(key);
  if (!raw) return null;
  await kv.delete(key);
  try {
    return JSON.parse(raw) as { next: string; redirectUri: string };
  } catch {
    return null;
  }
}
