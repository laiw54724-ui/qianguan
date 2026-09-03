// 權杖工具 — 對應架構規格 §4.1
// 產生：crypto.getRandomValues(16B) → Crockford Base32（約 128 bits）
// 儲存：只存 SHA-256(token) hex

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function crockford(bytes: Uint8Array): string {
  // 以 5-bit 為單位編碼
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

export function genToken(prefix: 'chr' | 'own' | 'inv'): string {
  const raw = crypto.getRandomValues(new Uint8Array(16));
  return `${prefix}_${crockford(raw).slice(0, 26).toLowerCase()}`;
}

export function genPublicId(): string {
  // 8 碼（40 bits），顯示分段 XXXX-XXXX（規格 §4.1）
  const raw = crypto.getRandomValues(new Uint8Array(5));
  const s = crockford(raw).slice(0, 8);
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

// 使用者輸入公開 ID／企劃代碼的正規化：一定會有人照字面打 I/L/O（規格 §4.1）
export function normPublicId(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

export function normSlug(input: string): string {
  return normPublicId(input).toLowerCase();
}

export function genSlug(): string {
  const raw = crypto.getRandomValues(new Uint8Array(5));
  return crockford(raw).slice(0, 8).toLowerCase();
}

export async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
