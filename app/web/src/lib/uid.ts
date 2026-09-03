// 內部 ID（區塊、欄位等不具授權意義的識別碼）
// 規格 §4.1：不用 Math.random——短 ID 會生日碰撞，且可枚舉會破壞 unlisted 的「連結不可猜」
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function uid(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let s = '';
  for (const b of bytes) s += CROCKFORD[b % 32];
  return prefix + s.toLowerCase();
}
