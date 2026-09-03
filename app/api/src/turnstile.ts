// turnstile.ts — §6.6 Cloudflare Turnstile 驗證。
// 掛在：POST /api/projects（/new）、POST .../characters（建角色）、POST .../relations（發起牽線）。
// 權杖驗證端點刻意不掛（§6.6：不對權杖驗證限速／加驗證碼）。

interface TurnstileResponse { success: boolean; 'error-codes'?: string[]; }

export async function verifyTurnstile(
  secret: string | undefined,
  token: string | undefined,
  ip: string | undefined,
): Promise<boolean> {
  // 未設 secret（本機開發）時放行；正式環境務必 wrangler secret put TURNSTILE_SECRET
  if (!secret) return true;
  if (!token) return false;
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    const data = (await res.json()) as TurnstileResponse;
    return !!data.success;
  } catch {
    return false;
  }
}
