// auth/oauthState.ts — 登入用的一次性 state（KV）。
// 讀一次就刪；5 分鐘沒用到就自然過期。callback 只信任這裡存的 next，不信任 query string。
const TTL_SECONDS = 300;

export async function createState(kv: KVNamespace, next: string): Promise<string> {
  const id = crypto.randomUUID();
  await kv.put(`oauth:${id}`, JSON.stringify({ next }), { expirationTtl: TTL_SECONDS });
  return id;
}

export async function consumeState(kv: KVNamespace, stateId: string): Promise<{ next: string } | null> {
  const key = `oauth:${stateId}`;
  const raw = await kv.get(key);
  if (!raw) return null;
  await kv.delete(key);
  try {
    return JSON.parse(raw) as { next: string };
  } catch {
    return null;
  }
}
