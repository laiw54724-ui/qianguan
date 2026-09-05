// 結構化欄位值的解析／序列化（值一律以 JSON 字串儲存，壞資料降級為空陣列）
import type { ChecklistItem, GalleryImage, PaletteColor, RadarDim, TimelineEvent } from './types';

function parseArr<T>(raw: string, guard: (x: unknown) => x is T): T[] {
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(guard);
  } catch {
    return [];
  }
}

const isStr = (x: unknown): x is string => typeof x === 'string';

export const parseChecklist = (raw: string): ChecklistItem[] =>
  parseArr(raw, (x): x is ChecklistItem => !!x && typeof x === 'object' && isStr((x as ChecklistItem).text));
// 編輯中保留空白列（否則「新增項目」會立刻被吃掉）；空白列由顯示端過濾
export const stringifyChecklist = (v: ChecklistItem[]): string => JSON.stringify(v);
export const checklistVisible = (v: ChecklistItem[]): ChecklistItem[] => v.filter((i) => i.text.trim());

export const parseRadar = (raw: string): RadarDim[] =>
  parseArr(raw, (x): x is RadarDim => !!x && typeof x === 'object' && isStr((x as RadarDim).label) && typeof (x as RadarDim).value === 'number')
    .map((d) => ({ label: d.label, value: Math.max(0, Math.min(5, Math.round(d.value))) }));
export const stringifyRadar = (v: RadarDim[]): string => JSON.stringify(v);
export const radarVisible = (v: RadarDim[]): RadarDim[] => v.filter((d) => d.label.trim());

export const parseTimeline = (raw: string): TimelineEvent[] =>
  parseArr(raw, (x): x is TimelineEvent => !!x && typeof x === 'object' && isStr((x as TimelineEvent).title));
export const stringifyTimeline = (v: TimelineEvent[]): string => JSON.stringify(v);
export const timelineVisible = (v: TimelineEvent[]): TimelineEvent[] => v.filter((e) => e.title.trim() || e.date.trim());

export const parsePalette = (raw: string): PaletteColor[] =>
  parseArr(raw, (x): x is PaletteColor => !!x && typeof x === 'object' && isStr((x as PaletteColor).hex));
export const stringifyPalette = (v: PaletteColor[]): string => JSON.stringify(v);
export const paletteVisible = (v: PaletteColor[]): PaletteColor[] => v.filter((c) => c.hex.trim());

// 關聯角色 / 標籤等「, 分隔」字串
export const parseCsv = (raw: string): string[] => raw.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
export const stringifyCsv = (v: string[]): string => v.filter(Boolean).join(',');

// Ticket-15：相簿一張圖片可能是舊資料的純字串，也可能是新的 { url, caption }——
// 讀取／編輯端一律先過這個函式統一成同一個形狀，不用為了加圖說就跑一次資料遷移。
export function normalizeGalleryImages(images: unknown): GalleryImage[] {
  if (!Array.isArray(images)) return [];
  const out: GalleryImage[] = [];
  for (const img of images) {
    if (typeof img === 'string' && img) out.push({ url: img });
    else if (img && typeof img === 'object' && typeof (img as GalleryImage).url === 'string' && (img as GalleryImage).url) {
      const caption = (img as GalleryImage).caption;
      out.push({ url: (img as GalleryImage).url, caption: typeof caption === 'string' ? caption : undefined });
    }
  }
  return out;
}

// 判斷欄位／區塊欄位是否有內容（顯示端用來略過空欄位）
export function fieldHasContent(type: string, content: string, images?: unknown[]): boolean {
  if (type === 'image') return (images?.length ?? 0) > 0 || /^(data:image|https?:)/.test(content);
  if (type === 'pdf') return /^(data:application\/pdf|https?:)/.test(content);
  switch (type) {
    case 'checklist': return checklistVisible(parseChecklist(content)).length > 0;
    case 'radar': return radarVisible(parseRadar(content)).length > 0;
    case 'timeline': case 'calendar': return timelineVisible(parseTimeline(content)).length > 0;
    case 'palette': return paletteVisible(parsePalette(content)).length > 0;
    case 'tags': case 'multiselect': case 'charref': return parseCsv(content).length > 0;
    default: return !!content.trim();
  }
}
