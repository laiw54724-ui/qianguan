import { useEffect, useState, useTransition } from 'react';
import { checkLeave, commitNavigate } from './dirty';
import { normSlug } from './tokens';

// Path routing：真實路徑，Worker 對非 /api/* 的路徑一律回 SPA shell（見 index.ts 的 catch-all）
export function navigate(path: string) {
  const p = path.startsWith('/') ? path : '/' + path;
  if (!checkLeave(p)) return; // 編輯頁有未儲存變更 → 攔截跳確認（規格 §12）
  commitNavigate(p);
}

// 1-2：換頁的 setState 包進 startTransition，isPending 拿去驅動頂部進度條（見 RouteProgress），
// 不再是固定時間的假動畫。監聽 popstate 同時涵蓋瀏覽器上一頁/下一頁跟 commitNavigate() 的手動事件。
export function usePathRoute(): { path: string; isPending: boolean } {
  const [path, setPath] = useState(() => window.location.pathname || '/');
  const [isPending, startPathTransition] = useTransition();
  useEffect(() => {
    const onChange = () => {
      const next = window.location.pathname || '/';
      startPathTransition(() => setPath(next));
    };
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { path, isPending };
}

export function href(path: string) {
  return path.startsWith('/') ? path : '/' + path;
}

/** 站內 <a href="/..."> 點擊時攔截成 client-side 導覽（不然瀏覽器會整頁重載）；
 * 取代原本掛在 dirty.ts 的 installClickGuard——path routing 下這支函式不只是「攔住 dirty 頁面」，
 * 還得真的完成導覽（pushState），職責變了所以搬過來。
 * 用 URL().origin 判斷是不是真的站內連結，不能只看開頭是不是 "/"——
 * "//example.com/foo" 這種協議相對網址也是以 "/" 開頭，字串前綴判斷會誤判成站內路徑，
 * 角色卡上的外部資料連結如果剛好是這個格式就會被攔下來導去一個不存在的站內路徑。 */
export function installLinkNavigation(): () => void {
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.rel.split(/\s+/).includes('external')) return;
    const raw = a.getAttribute('href') ?? '';
    // /api/... 是刻意要真的送到伺服器的（例如未來的第三方登入入口），不該被攔下來走前端路由
    if (!raw.startsWith('/') || raw.startsWith('/api/')) return;
    let url: URL;
    try {
      url = new URL(raw, window.location.origin);
    } catch {
      return;
    }
    if (url.origin !== window.location.origin) return; // "//other-host/..." 這類協議相對外部連結
    const path = url.pathname + url.search + url.hash;
    e.preventDefault();
    if (!checkLeave(path)) return; // 已經 preventDefault，攔下就留在原頁彈確認 modal
    commitNavigate(path);
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
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
