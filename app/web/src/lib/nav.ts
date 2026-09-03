import { useEffect, useState } from 'react';
import { checkLeave } from './dirty';
import { normSlug } from './tokens';

// Hash 路由：靜態預覽沒有伺服器 rewrite，全部走 #/ 路徑
export function navigate(path: string) {
  const p = path.startsWith('/') ? path : '/' + path;
  if (!checkLeave(p)) return; // 編輯頁有未儲存變更 → 攔截跳確認（規格 §12）
  window.location.hash = p;
}

export function useHashPath(): string {
  const [path, setPath] = useState(() => window.location.hash.replace(/^#/, '') || '/');
  useEffect(() => {
    const onChange = () => setPath(window.location.hash.replace(/^#/, '') || '/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return path;
}

export function href(path: string) {
  return '#' + (path.startsWith('/') ? path : '/' + path);
}

// 從使用者貼上的連結或純企劃 ID 解析 slug（I/L/O 寬容映射，規格 §4.1）
export function parseSlugInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/\/p\/([a-z0-9][a-z0-9-]{1,60})/i);
  if (m) return normSlug(m[1]);
  if (/^[a-z0-9][a-z0-9-]{1,60}$/i.test(s)) return normSlug(s);
  return null;
}

// 時間顯示
export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return '剛剛';
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(ts).toLocaleDateString('zh-TW');
}
