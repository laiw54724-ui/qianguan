// 編輯與儲存模型（規格 §12）：本機復原緩衝 + 離開守衛
//
// 原則：唯一真相永遠在伺服器。這裡的 localStorage 只是「還沒送出的輸入」的防當機備援，
// 不是草稿、任何人（包括其他頁面）都不會拿它當資料來源。
import { useEffect } from 'react';

const PREFIX = 'kg_buf_';

export interface Buffer<T> {
  data: T;
  savedAt: number;
}

export function saveBuffer<T>(key: string, data: T) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, savedAt: Date.now() } satisfies Buffer<T>));
  } catch {
    // 配額滿就算了——緩衝是備援，不是必要條件
  }
}

export function loadBuffer<T>(key: string): Buffer<T> | null {
  try {
    const s = localStorage.getItem(PREFIX + key);
    return s ? (JSON.parse(s) as Buffer<T>) : null;
  } catch {
    return null;
  }
}

export function clearBuffer(key: string) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

// ---------- 離開守衛 ----------
// 編輯頁註冊「是否 dirty + 怎麼儲存」；navigate() 換頁前先問過。
// 三向選擇：儲存並離開／捨棄離開／取消留在原頁。

export interface LeaveGuard {
  isDirty: () => boolean;
  save: () => Promise<boolean>; // true = 儲存成功
}

let guard: LeaveGuard | null = null;
let pendingPath: string | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((f) => f());
}

export function setLeaveGuard(g: LeaveGuard | null) {
  guard = g;
}

/** navigate() 專用：回傳 true 允許換頁；false 表示已攔截並跳出確認 modal */
export function checkLeave(path: string): boolean {
  if (!guard || !guard.isDirty()) return true;
  if (pendingPath) return false; // 已經在問了
  pendingPath = path;
  notify();
  return false;
}

/** 掛在 App 的 host 用 */
export function subscribeLeaveGuard(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 站內 <a href="#/..."> 不經 navigate()，在 capture 階段攔截 */
export function installClickGuard(): () => void {
  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest?.('a[href^="#/"]') as HTMLAnchorElement | null;
    if (!a) return;
    const path = (a.getAttribute('href') ?? '').slice(1);
    if (path && !checkLeave(path)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}

export function getPendingPath(): string | null {
  return pendingPath;
}

export async function resolveLeave(action: 'save' | 'discard' | 'cancel'): Promise<void> {
  const path = pendingPath;
  if (action === 'cancel' || !path) {
    pendingPath = null;
    notify();
    return;
  }
  if (action === 'save') {
    const ok = guard ? await guard.save() : true;
    if (!ok) {
      // 儲存失敗：留在原頁繼續問（modal 保持開著由呼叫端處理錯誤）
      return;
    }
  }
  pendingPath = null;
  guard = null;
  notify();
  location.hash = '#' + path;
}

/** 編輯頁掛守衛：beforeunload + 路由攔截。dirty 內容變動時重新註冊。 */
export function useLeaveGuard(dirty: boolean, save: () => Promise<boolean>) {
  useEffect(() => {
    if (!dirty) {
      setLeaveGuard(null);
      return;
    }
    setLeaveGuard({ isDirty: () => true, save });
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault(); // 行動版 Safari 不一定觸發，真正保險是本機緩衝
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      setLeaveGuard(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);
}
