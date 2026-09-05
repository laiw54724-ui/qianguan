import { useEffect, useMemo, useState } from 'react';
import { getProject, listCharacters } from '../lib/api';
import { href } from '../lib/nav';
import { PageLoading, CharAvatar, EmptyNote, FilterChips } from '../components/kg';
import { SocialLinkChips } from '../components/links';
import { ProjectShell } from '../components/project-shell';
import type { Character, Project } from '../lib/types';

export default function RosterPage({ slug }: { slug: string }) {
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [chars, setChars] = useState<Character[]>([]);
  const [filterTag, setFilterTag] = useState('');

  useEffect(() => {
    (async () => {
      // 1-2：企劃與角色清單並行抓，不要一輪一輪等
      const [p, cs] = await Promise.all([getProject(slug), listCharacters(slug)]);
      setProject(p ?? null);
      setChars(cs);
    })();
  }, [slug]);

  const vocab = useMemo(() => {
    const set = new Set<string>();
    for (const g of project?.tag_groups ?? []) g.tags.forEach((t) => set.add(t));
    for (const c of chars) (c.tags ?? []).forEach((t) => set.add(t));
    return [...set];
  }, [project, chars]);
  const shownChars = useMemo(
    () => (filterTag ? chars.filter((c) => (c.tags ?? []).includes(filterTag)) : chars),
    [chars, filterTag],
  );

  if (project === undefined) {
    return (
      <ProjectShell slug={slug} title="" active="roster">
        <PageLoading />
      </ProjectShell>
    );
  }
  if (project === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="font-huninn text-5xl mb-3">查無此企劃</div>
        <a href={href('/home')} className="kg-pill">回牽關首頁</a>
      </div>
    );
  }

  return (
    <ProjectShell slug={slug} title={project.title} iconUrl={project.icon_url} active="roster">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-8">
        <h1 className="font-huninn text-2xl mb-5">{project.title} ／ 名單</h1>
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
                      {c.status === 'draft' && (
                        <span className="kg-tag" style={{ background: '#fcebf0', color: '#a8455e' }}>草稿</span>
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
      </div>
    </ProjectShell>
  );
}
