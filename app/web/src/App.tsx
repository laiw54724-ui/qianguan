import { useEffect, type ReactNode } from 'react';
import { usePathRoute } from './lib/nav';
import { LeaveGuardHost, RouteProgress, Toaster, toast } from './components/kg';
import Poster from './pages/Poster';
import Home from './pages/Home';
import NewProject from './pages/NewProject';
import ProjectPage from './pages/Project';
import RosterPage from './pages/Roster';
import MinePage from './pages/Mine';
import JoinPage from './pages/Join';
import CharacterPage from './pages/Character';
import CharEditPage from './pages/CharEdit';
import RelationsPage from './pages/Relations';
import ManagePage from './pages/Manage';

export default function App() {
  const { path, isPending } = usePathRoute();
  const seg = path.split('/').filter(Boolean);

  // 全域兜底：任何漏接的非同步錯誤（例如儲存空間不足）都用 toast 告知，不靜默
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      const msg = e.reason instanceof Error ? e.reason.message : '';
      toast(msg || '操作失敗，請稍後再試', 'err');
      e.preventDefault();
    };
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
  }, []);

  let page: ReactNode;
  if (seg.length === 0) page = <Poster />;
  else if (seg[0] === 'home') page = <Home />;
  else if (seg[0] === 'new') page = <NewProject />;
  else if (seg[0] === 'p' && seg[1]) {
    const slug = seg[1];
    if (seg.length === 2) page = <ProjectPage slug={slug} />;
    else if (seg[2] === 'roster') page = <RosterPage slug={slug} />;
    else if (seg[2] === 'mine') page = <MinePage slug={slug} />;
    else if (seg[2] === 'join') page = <JoinPage slug={slug} />;
    else if (seg[2] === 'manage') page = <ManagePage slug={slug} />;
    else if (seg[2] === 'c' && seg[3]) {
      const charId = seg[3];
      if (seg.length === 4) page = <CharacterPage slug={slug} charId={charId} />;
      else if (seg[4] === 'edit') page = <CharEditPage slug={slug} charId={charId} />;
      else if (seg[4] === 'relations') page = <RelationsPage slug={slug} charId={charId} />;
      else page = <Home />;
    } else page = <Home />;
  } else page = <Home />;

  return (
    <>
      <a href="#main" className="kg-skiplink">
        跳到主要內容
      </a>
      <RouteProgress isPending={isPending} />
      <main id="main" tabIndex={-1} className="outline-none">{page}</main>
      <LeaveGuardHost />
      <Toaster />
    </>
  );
}
