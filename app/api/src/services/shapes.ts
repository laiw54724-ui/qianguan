// services/shapes.ts — 與 web/src/lib/types.ts 對齊的最小共用型別（API 輸出入用）。

export interface FieldDef {
  key: string;
  label: string;
  type?: string;
  options?: string[];
  placeholder?: string;
  required?: boolean;
  max?: number;
  style?: string;
  visibility?: 'public' | 'private';
}

export interface WorldBlock {
  id: string;
  title: string;
  fields: Record<string, unknown>[];
}

export interface RelationExtra {
  id: string;
  title: string;
  content: string;
}

/** JSON 欄位的防禦性解析：drizzle mode:'json' 正常會自動 parse，這裡擋字串殘留（讀修復） */
export function fromJson<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return fallback; }
  }
  return v as T;
}
