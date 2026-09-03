// 首頁「我的角色」清單 — 規格 §4.2：localStorage 只存公開 ID，絕對不存權杖。
// 權杖由後端以 httpOnly cookie 簽發，前端 JS 永遠讀不到。
const MYCHARS_KEY = 'kg_my_chars_v1';

export interface MyChar {
  slug: string;
  projectTitle: string;
  charId: string;
  name: string;
  addedAt: number;
}

export function myChars(): MyChar[] {
  try {
    const s = localStorage.getItem(MYCHARS_KEY);
    return s ? (JSON.parse(s) as MyChar[]) : [];
  } catch {
    return [];
  }
}

export function addMyChar(entry: Omit<MyChar, 'addedAt'>) {
  const list = myChars().filter((c) => !(c.slug === entry.slug && c.charId === entry.charId));
  list.unshift({ ...entry, addedAt: Date.now() });
  try {
    localStorage.setItem(MYCHARS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}
