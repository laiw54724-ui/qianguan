// 企劃層共用殼——工單 1-1：/p/:slug/* 底下所有頁面共用同一個頂部＋底部導覽，
// 建角色、牽線編輯等頁面不再跳出企劃的脈絡。
import type { ReactNode } from 'react';
import { Activity, Settings, User, Users } from 'lucide-react';
import { href } from '../lib/nav';

export type ProjectTab = 'feed' | 'roster' | 'mine' | 'settings' | null;

const TABS: { id: Exclude<ProjectTab, null>; label: string; icon: typeof Activity; path: (slug: string) => string }[] = [
  { id: 'feed', label: '動態', icon: Activity, path: (slug) => `/p/${slug}` },
  { id: 'roster', label: '名單', icon: Users, path: (slug) => `/p/${slug}/roster` },
  { id: 'mine', label: '我的', icon: User, path: (slug) => `/p/${slug}/mine` },
  { id: 'settings', label: '設定', icon: Settings, path: (slug) => `/p/${slug}/manage` },
];

export function ProjectShell({
  slug,
  title,
  active,
  children,
}: {
  slug: string;
  title: string;
  active: ProjectTab;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 border-b-2 border-[#e8dfd4] bg-[#fbf8f3]/95 backdrop-blur-sm">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 h-14 flex items-center">
          <a href={href(`/p/${slug}`)} className="flex items-center gap-2 min-w-0 group">
            <img src="/logo-mark.svg" alt="" className="w-6 h-6 shrink-0 group-hover:scale-110 transition-transform" />
            <span className="font-logo text-lg truncate group-hover:text-[#9e4b2c] transition-colors">{title || '牽關'}</span>
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
