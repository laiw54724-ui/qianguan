// 企劃層共用殼——工單 1-1：/p/:slug/* 底下所有頁面共用同一個頂部＋底部導覽，
// 建角色、牽線編輯等頁面不再跳出企劃的脈絡。
import { useEffect, type ReactNode } from 'react';
import { Activity, Settings, User, Users } from 'lucide-react';
import { href } from '../lib/nav';
import { SHELL_HEADER_HEIGHT } from './kg';

export type ProjectTab = 'feed' | 'roster' | 'mine' | 'settings' | null;

const TABS: { id: Exclude<ProjectTab, null>; label: string; icon: typeof Activity; path: (slug: string) => string }[] = [
  { id: 'feed', label: '動態', icon: Activity, path: (slug) => `/p/${slug}` },
  { id: 'roster', label: '名單', icon: Users, path: (slug) => `/p/${slug}/roster` },
  { id: 'mine', label: '我的', icon: User, path: (slug) => `/p/${slug}/mine` },
  { id: 'settings', label: '設定', icon: Settings, path: (slug) => `/p/${slug}/manage` },
];

// Ticket-07：每個用到 ProjectShell 的頁面各自 fetch 自己的 project，在資料回來前一律傳
// title=""——切換企劃內分頁（動態／名單／我的／設定）時，即使上一頁才剛拿到同一份
// project 資料，頁首還是會先閃回空字串的預設值，才又跳回正確標題／頭像。用 slug 記住
// 上一次拿到的 title／iconUrl，資料還沒回來前先顯示這份快取，不用等每個頁面重新 fetch。
const shellCache = new Map<string, { title: string; iconUrl: string | null }>();

export function ProjectShell({
  slug,
  title,
  iconUrl,
  active,
  children,
}: {
  slug: string;
  title: string;
  iconUrl?: string | null;
  active: ProjectTab;
  children: ReactNode;
}) {
  if (title) shellCache.set(slug, { title, iconUrl: iconUrl ?? null });
  const cached = shellCache.get(slug);
  const displayTitle = title || cached?.title || '牽關';
  const displayIcon = title ? (iconUrl ?? null) : (cached?.iconUrl ?? null);
  const letter = Array.from(displayTitle)[0] ?? '?';
  // Ticket-05：頁首是 position: sticky，在正常文件流裡仍佔一份高度——但瀏覽器原生的
  // 「捲到某元素」行為（focus 一個欄位時、手機鍵盤彈出讓可視區域重排、或網址帶 #hash）
  // 只看文件流位置，不知道頁首視覺上疊在最上面那一段。結果是目標元素捲到 y=0 就被
  // 頁首蓋住一截。scroll-padding-top 讓這些原生捲動行為自動多留頁首的高度，不用逐一
  // 幫每個可能的錨點加 scroll-margin-top。只在企劃殼掛著的期間套用，離開時還原。
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.style.scrollPaddingTop;
    root.style.scrollPaddingTop = `${SHELL_HEADER_HEIGHT}px`;
    return () => {
      root.style.scrollPaddingTop = prev;
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 border-b-2 border-[#e8dfd4] bg-[#fbf8f3]/95 backdrop-blur-sm">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 h-14 flex items-center">
          <a href={href(`/p/${slug}`)} className="flex items-center gap-2 min-w-0 group">
            {displayIcon ? (
              <img
                src={displayIcon}
                alt=""
                className="w-6 h-6 rounded-full object-cover shrink-0 group-hover:scale-110 transition-transform"
              />
            ) : (
              <span
                aria-hidden="true"
                className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold text-white bg-[#9e4b2c] group-hover:scale-110 transition-transform"
              >
                {letter}
              </span>
            )}
            <span className="font-logo text-lg truncate group-hover:text-[#9e4b2c] transition-colors">{displayTitle}</span>
          </a>
        </div>
      </header>

      {/* App.tsx 的 <main id="main"> 已經是這頁唯一的 main landmark（skip link 的目標），
          這裡不能再放一個 <main>，會變成巢狀 main 違反語意 HTML／WCAG。 */}
      <div className="flex-1 pb-20">{children}</div>

      <nav
        aria-label="企劃導覽"
        className="fixed bottom-0 inset-x-0 z-40 border-t-2 border-[#e8dfd4] bg-[#fbf8f3]/97 backdrop-blur-sm"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto max-w-5xl grid grid-cols-4">
          {TABS.map((t) => {
            const isActive = active === t.id;
            const Icon = t.icon;
            return (
              <a
                key={t.id}
                href={href(t.path(slug))}
                aria-current={isActive ? 'page' : undefined}
                className="flex flex-col items-center justify-center gap-0.5 py-2.5 min-h-[56px] transition-colors"
                style={{ color: isActive ? '#9e4b2c' : '#6f6156' }}
              >
                <Icon size={20} strokeWidth={isActive ? 2.4 : 2} aria-hidden />
                <span className={`text-[11px] ${isActive ? 'font-bold' : 'font-medium'}`}>{t.label}</span>
              </a>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
