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

export interface SocialLink {
  id: string;
  platform: string;
  label: string;
  url: string;
  previewTitle?: string;
}

export interface TagGroup {
  id: string;
  name: string;
  tags: string[];
  required?: boolean;
}

const MAX_LINKS = 8;

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^\/\//.test(t)) return `https:${t}`;
  return `https://${t}`;
}

export function sanitizeLinks(input: unknown): SocialLink[] {
  if (!Array.isArray(input)) return [];
  const out: SocialLink[] = [];
  for (const row of input) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const url = typeof r.url === 'string' ? normalizeUrl(r.url) : '';
    if (!url) continue;
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    } catch {
      continue;
    }
    const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim().slice(0, 64) : `lnk_${out.length}`;
    const platform = typeof r.platform === 'string' ? r.platform.slice(0, 32) : 'custom';
    const label = typeof r.label === 'string' ? r.label.trim().slice(0, 80) : '';
    const previewTitle = typeof r.previewTitle === 'string' ? r.previewTitle.trim().slice(0, 200) : '';
    out.push({ id, platform, label, url: url.slice(0, 2000), previewTitle: previewTitle || undefined });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

export function sanitizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const t of input) {
    if (typeof t !== 'string') continue;
    const s = t.trim().slice(0, 40);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 40) break;
  }
  return out;
}

export function sanitizeTagGroups(input: unknown): TagGroup[] {
  if (!Array.isArray(input)) return [];
  const out: TagGroup[] = [];
  for (const row of input) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, 80) : '';
    const tags = sanitizeTags(r.tags).slice(0, 50);
    if (!name || !tags.length) continue;
    const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim().slice(0, 64) : `tg_${out.length}`;
    out.push({ id, name, tags, required: !!r.required });
    if (out.length >= 20) break;
  }
  return out;
}

/** JSON 欄位的防禦性解析：drizzle mode:'json' 正常會自動 parse，這裡擋字串殘留（讀修復） */
export function fromJson<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return fallback; }
  }
  return v as T;
}
