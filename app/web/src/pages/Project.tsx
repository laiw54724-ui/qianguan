import { useCallback, useEffect, useMemo, useState } from 'react';
import { acceptedRelations, FEED_LIMIT, feed, getProject, listCharacters } from '../lib/api';

import { href, timeAgo } from '../lib/nav';
import { PageLoading, BlockView, FilterChips, SiteHeader, CharAvatar, EmptyNote, PreviewModal, ThreadLink, type PreviewTarget, type RosterLite } from '../components/kg';
import { SocialLinkChips } from '../components/links';
import type { Character, KgEvent, Project } from '../lib/types';

// 名字一定要帶頭像（行內小頭像 + 粗體名字）
function NameTag({ c, fallback }: { c?: Character; fallback?: string }) {
  const name = c?.name ?? fallback ?? '有人';
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <CharAvatar name={name} url={c?.avatar_url ?? null} size={20} />
      <b>{name}</b>
    </span>
  );
}

function FeedItem({ ev, chars }: { ev: KgEvent; chars: Map<string, Character> }) {
  const actor = ev.actor_id ? chars.get(ev.actor_id) : undefined;
  const target = ev.target_id ? chars.get(ev.target_id) : undefined;
  let body: React.ReactNode = null;
  switch (ev.type) {
    case 'char_joined':
      body = (
        <>
          <NameTag c={actor} fallback={ev.payload.name} /> 加入了企劃
        </>
      );
      break;
    case 'char_updated':
      body = (
        <>
          <NameTag c={actor} fallback={ev.payload.name} /> 更新了角色卡
        </>
      );
      break;
    case 'relation_accepted':
      body = (
        <>
          <NameTag c={actor} fallback={ev.payload.a} />
          <ThreadLink className="inline-block w-9 mx-1 align-middle" />
          <NameTag c={target} fallback={ev.payload.b} /> 牽線成功
        </>
      );
      break;
    case 'announcement':
      body = (
        <>
          <span className="kg-tag mr-2" style={{ background: '#7fc0dc' }}>
            公告
          </span>
          {ev.payload.text}
        </>
      );
      break;
  }
  return (
    <div className="flex items-center gap-3 py-3 border-b border-dashed border-[#e8dfd4]/25 last:border-0">
      {actor ? (
        <CharAvatar name={actor.name} url={actor.avatar_url} size={34} />
      ) : (
        <div className="w-[34px] h-[34px] rounded-full border-2 border-[#e8dfd4] bg-[#7fc0dc] flex items-center justify-center font-huninn">
          告
        </div>
      )}
      <div className="flex-1 text-sm leading-relaxed">{body}</div>
      <div className="font-mono2 text-[11px] text-[#6f6156] shrink-0">{timeAgo(ev.created_at)}</div>
    </div>
  );
}

// ---------- 企劃微站導覽 ----------
function ProjectNav({ project }: { project: Project }) {
  const items: Array<[string, string]> = [
    ['intro', '簡介'],
    ['world', '世界觀'],
    ...(project.qa.length > 0 ? ([['qa', '問答']] as Array<[string, string]>) : []),
    ['roster', '名單'],
    ['feed', '動態'],
  ];
  // hash 路由被 SPA 佔用，站內錨點改用 scrollIntoView，避免覆寫 location.hash
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <header className="sticky top-0 z-40 border-b-2 border-[#e8dfd4] bg-[#fbf8f3]/95 backdrop-blur-sm">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        <button type="button" onClick={() => scrollTo('intro')} className="flex items-center gap-2.5 min-w-0 group cursor-pointer">
          {project.cover_url ? (
            <img src={project.cover_url} alt="" className="w-9 h-9 rounded-lg border border-[#e8dfd4] object-cover shrink-0" />
          ) : (
            <div className="w-9 h-9 rounded-lg border border-[#e8dfd4] bg-[#fbf8f3] flex items-center justify-center shrink-0 p-1.5">
              <img src="/logo-mark.svg" alt="" className="w-full h-full" />
            </div>
          )}
          <span className="font-logo text-xl truncate group-hover:text-[#9e4b2c] transition-colors">{project.title}</span>
        </button>
        <nav className="flex items-center gap-1 sm:gap-2 shrink-0">
          {items.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => scrollTo(id)}
              className="px-2.5 sm:px-3 py-1.5 rounded-full text-sm font-bold text-[#4a3b31] hover:bg-[#e9f3f9] hover:text-[#8a3f23] transition-colors cursor-pointer"
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}

// ---------- 企劃微站頁尾：回牽關主站 ----------
function ProjectFooter({ title }: { title: string }) {
  return (
    <footer className="mt-20 border-t-2 border-[#e8dfd4] py-10">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 flex flex-col items-center gap-3 text-center">
        <div className="font-mono2 text-[11px] tracking-[0.2em] text-[#6f6156]">
          {title} ・ POWERED BY
        </div>
        <a href={href('/')} className="flex items-center gap-2.5 group">
          <img src="/logo-mark.svg" alt="牽關 logo" className="w-11 h-11 group-hover:scale-110 transition-transform" />
          <span className="font-logo text-2xl group-hover:text-[#9e4b2c] transition-colors">由 牽關 製作</span>
        </a>
        <p className="text-xs text-[#6f6156]">為你的 OC 企劃，牽起每一條關係線——點這裡認識牽關，或開一個自己的企劃。</p>
      </div>
    </footer>
  );
}

export default function ProjectPage({ slug }: { slug: string }) {
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [chars, setChars] = useState<Character[]>([]);
  const [events, setEvents] = useState<KgEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [relCount, setRelCount] = useState(0);
  const [mineHere, setMineHere] = useState<string[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [preview, setPreview] = useState<{ block: PreviewTarget; idx: number } | null>(null);
  const [filterTag, setFilterTag] = useState('');
  const [qaFilter, setQaFilter] = useState('');

  const loadFeed = useCallback(
    async (before?: number) => {
      const page = await feed(slug, before);
      setEvents((prev) => (before === undefined ? page : [...prev, ...page]));
      setHasMore(page.length === FEED_LIMIT);
    },
    [slug],
  );

  useEffect(() => {
    (async () => {
      const p = await getProject(slug);
      setProject(p ?? null);
      if (!p) return;
      const cs = await listCharacters(slug);
      setChars(cs);
      setRelCount((await acceptedRelations(slug)).length);
      await loadFeed();
      // 身分由伺服器依 cookie 推斷（前端不碰權杖）
      setMineHere(p.viewer.myCharIds);
      setIsOwner(p.viewer.isOwner);
      document.title = `${p.title} — 牽關`;
      // unlisted → noindex（規格 §6.4）
      if (p.visibility === 'unlisted') {
        const meta = document.createElement('meta');
        meta.name = 'robots';
        meta.content = 'noindex, nofollow';
        document.head.appendChild(meta);
      }
    })();
  }, [slug, loadFeed]);

  const charMap = useMemo(() => new Map(chars.map((c) => [c.id, c])), [chars]);
  const rosterLite: RosterLite[] = useMemo(() => chars.map((c) => ({ id: c.id, name: c.name, avatar_url: c.avatar_url })), [chars]);
  const vocab = useMemo(() => {
    const set = new Set<string>();
    for (const g of project?.tag_groups ?? []) g.tags.forEach((t) => set.add(t));
    for (const c of chars) (c.tags ?? []).forEach((t) => set.add(t));
    return [...set];
  }, [project, chars]);
  const qaTags = useMemo(
    () => [...new Set((project?.qa ?? []).flatMap((q) => q.tags ?? []))],
    [project],
  );
  const shownChars = useMemo(
    () => (filterTag ? chars.filter((c) => (c.tags ?? []).includes(filterTag)) : chars),
    [chars, filterTag],
  );
  const shownQa = useMemo(
    () => (qaFilter ? project?.qa.filter((q) => (q.tags ?? []).includes(qaFilter)) ?? [] : project?.qa ?? []),
    [project, qaFilter],
  );

  if (project === undefined) return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <PageLoading />
      </main>
    </div>
  );
  if (project === null) {
    return (
      <div className="min-h-screen flex flex-col">
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center">
            <div className="font-huninn text-5xl mb-3">查無此企劃</div>
            <a href={href('/home')} className="kg-pill">
              回牽關首頁
            </a>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <ProjectNav project={project} />

      <main className="mx-auto max-w-5xl px-4 sm:px-6 w-full flex-1">
        {/* 簡介 hero */}
        <section id="intro" className="scroll-mt-24 pt-10 kg-rise">
          {project.cover_url ? (
            <img src={project.cover_url} alt="" className="w-full aspect-[16/9] object-cover rounded-2xl border-2 border-[#e8dfd4]" />
          ) : (
            <div className="w-full aspect-[16/9] rounded-2xl border-2 border-[#e8dfd4] bg-[#fbf8f3] flex items-center justify-center">
              <img src="/logo-mark.svg" alt="" className="w-24 opacity-90" />
            </div>
          )}

          <div className="mt-8 grid lg:grid-cols-[1fr_320px] gap-8 items-start">
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                {project.is_verified && (
                  <span className="kg-tag" style={{ background: '#7fc0dc' }}>
                    官方認證
                  </span>
                )}
                {project.visibility === 'unlisted' && <span className="kg-tag">未列出</span>}
                {!project.signups_open && <span className="kg-tag">已截止報名</span>}
              </div>
              <h1 className="font-logo text-5xl leading-tight">{project.title}</h1>
              {project.summary && <p className="mt-4 text-[#4a3b31] leading-relaxed">{project.summary}</p>}
              <div className="mt-4">
                <SocialLinkChips links={project.links} />
              </div>

              <div className="font-mono2 text-xs text-[#6f6156] mt-5 space-y-1">
                <div>{chars.length} 位角色 ・ {relCount} 條已牽成</div>
                <div>加入方式：{project.join_mode === 'open' ? '自由加入' : '需要加入碼'}</div>
              </div>

              <div className="flex flex-wrap gap-2.5 mt-6">
                {project.signups_open && (
                  <a href={href(`/p/${slug}/join`)} className="kg-pill kg-pill-red">
                    ＋ 加入企劃
                  </a>
                )}
                <a href={href(`/p/${slug}/manage`)} className="kg-pill kg-pill-ghost kg-pill-sm">
                  {isOwner ? '開設者後台' : '我是開設者'}
                </a>
              </div>
            </div>

            <div className="space-y-5">
              {project.announcement && (
                <div className="kg-card-flat p-4" style={{ background: '#7fc0dc33' }}>
                  <div className="kg-seclabel mb-1">（主辦公告）</div>
                  <p className="text-sm leading-relaxed">{project.announcement}</p>
                </div>
              )}
              {mineHere.length > 0 && (
                <div className="kg-card-flat p-4">
                  <div className="kg-seclabel mb-2">（我在此企劃的角色）</div>
                  <div className="space-y-2">
                    {mineHere.map((id) => {
                      const c = charMap.get(id);
                      if (!c) return null;
                      return (
                        <div key={id} className="flex items-center gap-2 flex-wrap">
                          <a href={href(`/p/${slug}/c/${id}`)} className="flex items-center gap-2 font-bold hover:text-[#9e4b2c]">
                            <CharAvatar name={c.name} url={c.avatar_url} size={28} />
                            {c.name}
                          </a>
                          <a href={href(`/p/${slug}/c/${id}/relations`)} className="kg-pill kg-pill-sm kg-pill-sage">
                            牽線管理
                          </a>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 世界觀：區塊制 */}
        {project.world_blocks.length > 0 && (
          <section id="world" className="scroll-mt-24 mt-16 kg-rise">
            <h2 className="font-huninn text-2xl mb-5">世界觀</h2>
            <div className="space-y-4">
              {project.world_blocks.map((b) => (
                <BlockView
                  key={b.id}
                  block={b}
                  slug={slug}
                  roster={rosterLite}
                  canSeePrivate={isOwner}
                  onPreview={(t, i) => setPreview({ block: t, idx: i })}
                />
              ))}
            </div>
          </section>
        )}

        {/* 常見問答 */}
        {project.qa.length > 0 && (
          <section id="qa" className="scroll-mt-24 mt-16 kg-rise">
            <h2 className="font-huninn text-2xl mb-5">常見問答</h2>
            <FilterChips
              groups={(project.tag_groups ?? []).map((g) => ({
                ...g,
                tags: g.tags.filter((t) => qaTags.includes(t)),
              }))}
              tags={qaTags}
              value={qaFilter}
              onChange={setQaFilter}
            />
            <div className="space-y-3.5">
              {shownQa.map((item) => (
                <div key={item.id} className="kg-card-flat p-5">
                  <div className="flex gap-3">
                    <span className="font-logo text-[#9e4b2c] text-lg leading-none shrink-0 w-6">Q</span>
                    <div className="font-bold leading-relaxed">{item.q}</div>
                  </div>
                  {(item.tags ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2 pl-9">
                      {item.tags!.map((t) => (
                        <span key={t} className="kg-tag">{t}</span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-3 mt-3 pt-3 border-t border-dashed border-[#e8dfd4]">
                    <span className="font-logo text-[#24697f] text-lg leading-none shrink-0 w-6">A</span>
                    <div className="text-[15px] text-[#4a3b31] leading-loose whitespace-pre-wrap">{item.a || <span className="text-[#7a6f63]">（還沒有回答）</span>}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 名單 */}
        <section id="roster" className="scroll-mt-24 mt-16 kg-rise">
          <h2 className="font-huninn text-2xl mb-5">名單</h2>
          <FilterChips groups={project.tag_groups} tags={vocab} value={filterTag} onChange={setFilterTag} />
          {shownChars.length === 0 ? (
            <EmptyNote>{filterTag ? '這個分類還沒有角色。' : '還沒有角色——成為第一個登船的人吧。'}</EmptyNote>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {shownChars.map((c) => (
                <div key={c.id} className="kg-card p-4">
                  <a
                    href={href(`/p/${slug}/c/${c.id}`)}
                    className="flex gap-3 items-start hover:-translate-y-1 transition-transform"
                  >
                    <CharAvatar name={c.name} url={c.avatar_url} size={46} />
                    <div className="min-w-0">
                      <div className="font-bold flex items-center gap-2 flex-wrap">
                        {c.name}
                        <span className="font-mono2 text-[10px] text-[#6f6156] font-normal">{c.id}</span>
                        {c.slot && (
                          <span className="kg-tag" style={{ background: '#fcebf0', color: '#a8455e' }}>
                            空位
                          </span>
                        )}
                        {!c.slot && c.status === 'draft' && (
                          <span className="kg-tag" style={{ background: '#fcebf0', color: '#a8455e' }}>
                            草稿
                          </span>
                        )}
                      </div>
                      {c.one_liner && <p className="text-sm text-[#6f6156] mt-0.5 line-clamp-2 leading-relaxed">{c.one_liner}</p>}
                      {(c.tags ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {(c.tags ?? []).map((t) => (
                            <span key={t} className="kg-tag">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </a>
                  <SocialLinkChips links={c.links} compact />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 動態 */}
        <section id="feed" className="scroll-mt-24 mt-16 kg-rise">
          <h2 className="font-huninn text-2xl mb-3">動態牆</h2>
          <div className="kg-card-flat px-5 py-2">
            {events.length === 0 ? (
              <div className="py-8 text-center text-sm text-[#6f6156]">還沒有動態。</div>
            ) : (
              events.map((ev) => <FeedItem key={ev.id} ev={ev} chars={charMap} />)
            )}
          </div>
          {hasMore && events.length > 0 && (
            <div className="mt-4 text-center">
              <button
                type="button"
                className="kg-pill kg-pill-sm"
                onClick={() => loadFeed(events[events.length - 1].created_at)}
              >
                載入更早的動態
              </button>
            </div>
          )}
          <p className="font-mono2 text-[11px] text-[#6f6156] mt-3">＊ 待處理與已婉拒的牽線不會出現在動態牆。</p>
        </section>
      </main>

      <ProjectFooter title={project.title} />
      {preview && <PreviewModal block={preview.block} startIndex={preview.idx} onClose={() => setPreview(null)} />}
    </div>
  );
}
