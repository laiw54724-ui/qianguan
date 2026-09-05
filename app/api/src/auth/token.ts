// 權杖與 ID 工具 — 規格 §4.1
// 產生：crypto.getRandomValues(16B) → Crockford Base32（約 128 bits）
// 儲存：只存 SHA-256(token) hex；隨機權杖用單向雜湊已足夠，不用 bcrypt/argon2
// 比對：hash 相等即可，不需要 constant-time（比對的是雜湊值不是權杖本身，時序攻擊無利用價值）

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function crockford(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}

export function genToken(prefix: 'ses'): string {
  return `${prefix}_${crockford(crypto.getRandomValues(new Uint8Array(16))).slice(0, 26).toLowerCase()}`;
}

/** 公開 ID：8 碼 40 bits，CSPRNG（不可枚舉是 unlisted 企劃的唯一防線） */
export function genPublicId(): string {
  const s = crockford(crypto.getRandomValues(new Uint8Array(5))).slice(0, 8);
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function genSlug(): string {
  return crockford(crypto.getRandomValues(new Uint8Array(5))).slice(0, 8).toLowerCase();
}

/** R2 圖片 key 用（§8.3）：img/<random22>.webp */
export function randomKey(len = 22): string {
  return crockford(crypto.getRandomValues(new Uint8Array(Math.ceil((len * 5) / 8)))).slice(0, len).toLowerCase();
}

export async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 加入碼正規化：建立與驗證必須同一規則。
 * 拿掉全部空白（不只是頭尾）——加入碼是要在 Discord 上手動轉述、打字的一次性密語，
 * 不是結構化欄位，「Fog 2026」跟「fog2026」對使用者來說是同一組密語，只是打字習慣不同。
 * 0-1 驗收標準明確要求這兩種都要能通過。 */
export const normJoinCode = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** 使用者輸入公開 ID 的正規化：I/L→1、O→0 寬容映射（§4.1） */
export const normPublicId = (s: string) => s.trim().toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0');

export const AUTH_FAIL = '企劃不存在或權杖錯誤'; // §6.9 統一失敗訊息
