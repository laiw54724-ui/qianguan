import { useEffect, useMemo, useState } from 'react';
import { getProject, listCharacters, listPublicProjects } from '../lib/api';
import { myChars, type MyChar } from '../lib/session';
import { href, navigate, parseSlugInput, timeAgo } from '../lib/nav';
import { CharAvatar, SecLabel, SiteFooter, SiteHeader } from '../components/kg';
import type { Project } from '../lib/types';

// 私密企劃直達：貼連結或企劃 ID
function DirectAccess() {
  const [v, setV] = useState('');
  const [err, setErr] = useState('');
  const go = async () => {
    const slug = parseSlugInput(v);
    if (!slug) {
      setErr('看不出這是哪個企劃——貼上完整連結或企劃 ID 試試。');
      return;
    }
    const p = await getProject(slug);
    if (!p) {
      setErr('找不到這個企劃，確認一下連結或 ID 有沒有打錯。');
      return;
    }
    navigate(`/p/${slug}`);
  };
  return (
    <section className="kg-rise" style={{ animationDelay: '0.12s' }}>
      <div className="kg-card-flat p-5 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-huninn">私密企劃直達</div>
          <div className="text-xs text-[#6f6156] mt-0.5">「未列出」的企劃不會出現在上方列表，貼上連結或企劃 ID 就能進去。</div>
        </div>
        <div className="flex gap-2 w-full sm:w-[380px] shrink-0">
          <input
            className="kg-input !rounded-full !w-auto flex-1 min-w-0"
            placeholder="貼上企劃連結或 ID…"
            value={v}
            onChange={(e) => {
              setV(e.target.value);
              setErr('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && go()}
          />
          <button type="button" className="kg-pill kg-pill-red shrink-0" onClick={go}>
            前往 →
          </button>
        </div>
      </div>
      {err && <p className="text-sm text-[#a8455e] mt-2 pl-2">{err}</p>}
    </section>
  );
}

function ProjectCard({ p, count }: { p: Project; count: number }) {
  const thumb = p.icon_url ?? p.cover_url;
  return (
    <a href={href(`/p/${p.slug}`)} className="kg-card p-5 flex gap-4 items-start hover:-translate-y-1 transition-transform">
      {thumb ? (
        <img src={thumb} alt="" className="w-16 h-16 rounded-xl border border-[#e8dfd4] object-cover shrink-0" />
      ) : (
        <div className="w-16 h-16 rounded-xl border border-[#e8dfd4] bg-[#fbf8f3] flex items-center justify-center shrink-0 p-3">
          <img src="/logo-mark.svg" alt="" className="w-full h-full" />
        </div>
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-huninn text-lg truncate">{p.title}</h3>
          {p.is_verified && (
            <span className="kg-tag" style={{ background: '#7fc0dc', color: '#33261e' }}>
              認證
            </span>
          )}
          {!p.signups_open && <span className="kg-tag">已截止</span>}
        </div>
        <p className="text-sm text-[#6f6156] mt-1 line-clamp-2 leading-relaxed">{p.summary}</p>
        <div className="font-mono2 text-xs text-[#6f6156] mt-2">
          {count} 位角色 ・ 更新於 {timeAgo(p.updated_at)}
        </div>
      </div>
    </a>
  );
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [mine, setMine] = useState<MyChar[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      const list = await listPublicProjects();
      setProjects(list);
      const map: Record<string, number> = {};
      for (const p of list) {
        map[p.slug] = (await listCharacters(p.slug)).length;
      }
      setCounts(map);
      setMine(myChars());
    })();
  }, []);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return projects;
    return projects.filter((p) => (p.title + p.summary + p.world_note).toLowerCase().includes(kw));
  }, [projects, q]);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      <main className="mx-auto max-w-4xl px-4 sm:px-6 py-10 w-full space-y-12 flex-1">
        {/* 搜尋欄 */}
        <div className="kg-rise">
          <div className="relative">
            <svg
              viewBox="0 0 24 24"
              className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#6f6156]"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20 L16.5 16.5" />
            </svg>
            <input
              className="kg-input !rounded-full !pl-12 !py-3.5 !text-base shadow-[0_1px_3px_rgba(51,38,30,0.05)]"
              placeholder="搜尋企劃… SEARCH PROJECTS"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        {/* 我的角色 */}
        {mine.length > 0 && !q && (
          <section className="kg-rise">
            <SecLabel>我的角色 MY CHARACTERS</SecLabel>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mt-4">
              {mine.map((c) => (
                <a
                  key={`${c.slug}/${c.charId}`}
                  href={href(`/p/${c.slug}/c/${c.charId}`)}
                  className="kg-card p-4 flex items-center gap-3 hover:-translate-y-1 transition-transform"
                >
                  <CharAvatar name={c.name} size={40} />
                  <div className="min-w-0">
                    <div className="font-bold truncate">{c.name}</div>
                    <div className="font-mono2 text-xs text-[#6f6156] truncate">
                      {c.projectTitle} ・ {c.charId}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* 企劃列表 */}
        <section className="kg-rise" style={{ animationDelay: '0.08s' }}>
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <SecLabel>公開企劃 PROJECTS</SecLabel>
            <span className="font-mono2 text-xs text-[#6f6156]">
              {filtered.length} / {projects.length}
            </span>
          </div>
          {filtered.length === 0 ? (
            <div className="border-2 border-dashed border-[#e8dfd4] rounded-2xl px-6 py-12 text-center text-[#6f6156] mt-4">
              {q ? (
                <>
                  找不到「{q}」相關的企劃。
                  <button type="button" className="text-[#9e4b2c] font-bold underline ml-1" onClick={() => setQ('')}>
                    清除搜尋
                  </button>
                </>
              ) : (
                <>
                  目前還沒有公開企劃——
                  <a href={href('/new')} className="text-[#9e4b2c] font-bold underline">
                    開第一個
                  </a>
                  吧。
                </>
              )}
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4 mt-4">
              {filtered.map((p) => (
                <ProjectCard key={p.id} p={p} count={counts[p.id] ?? counts[p.slug] ?? 0} />
              ))}
            </div>
          )}
          <p className="font-mono2 text-xs text-[#6f6156] mt-4">＊ 設為「未列出」的企劃不會出現在這裡，也不提供索引。</p>
        </section>

        {/* 私密企劃直達 */}
        <DirectAccess />
      </main>

      {/* 創建 FAB */}
      <a
        href={href('/new')}
        aria-label="建立企劃"
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-[#9e4b2c] text-white flex items-center justify-center shadow-[0_6px_16px_rgba(158,75,44,0.3)] hover:bg-[#8a3f23] hover:-translate-y-0.5 transition-all"
      >
        <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M12 5 v14 M5 12 h14" />
        </svg>
      </a>

      <SiteFooter />
    </div>
  );
}
