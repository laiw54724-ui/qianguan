// auth/nextPath.ts — next 參數驗證（登入後的導向目標）。
// 只接受站內、單一 / 開頭的路徑；不符合一律靜默退回預設值，不是錯誤（開放重導向防線）。
const DEFAULT_NEXT = '/dashboard';

export function validateNextPath(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_NEXT;
  if (!raw.startsWith('/')) return DEFAULT_NEXT;
  if (raw.startsWith('//')) return DEFAULT_NEXT;
  if (raw.includes('\\')) return DEFAULT_NEXT;
  if (/[\r\n]/.test(raw)) return DEFAULT_NEXT;
  return raw;
}
