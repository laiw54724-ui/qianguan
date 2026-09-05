import { useEffect, useState } from 'react';
import { getCharacter, getProject, type ProjectView } from '../lib/api';
import { href } from '../lib/nav';
import { PageLoading, CharAvatar, EmptyNote } from '../components/kg';
import { ProjectShell } from '../components/project-shell';
import type { Character } from '../lib/types';

export default function MinePage({ slug }: { slug: string }) {
  const [project, setProject] = useState<ProjectView | null | undefined>(undefined);
  const [mine, setMine] = useState<Character[]>([]);

  useEffect(() => {
    (async () => {
      const p = await getProject(slug);
      setProject(p ?? null);
      if (!p) return;
      // 用 getCharacter 逐隻查，不是 listCharacters——後者只回 status='active'，
      // 剛加入、還沒存過第一次的草稿角色會被濾掉，但那也是「我的角色」，要顯示出來
      // 讓使用者能點進去繼續填、不是憑空消失。
      const views = await Promise.all(p.viewer.myCharIds.map((id) => getCharacter(slug, id)));
      setMine(views.filter((v): v is NonNullable<typeof v> => v !== null).map((v) => v.character));
    })();
  }, [slug]);

  if (project === undefined) {
    return (
      <ProjectShell slug={slug} title="" active="mine">
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
    <ProjectShell slug={slug} title={project.title} iconUrl={project.icon_url} active="mine">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-8">
        <h1 className="font-huninn text-2xl mb-5">{project.title} ／ 我的角色</h1>
        {mine.length === 0 ? (
          <EmptyNote>
            這個瀏覽器還沒有你在這個企劃的角色——用編輯碼在「名單」貼碼救援，或直接加入企劃。
          </EmptyNote>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {mine.map((c) => (
              <div key={c.id} className="kg-card p-4">
                <a href={href(`/p/${slug}/c/${c.id}`)} className="flex gap-3 items-start hover:-translate-y-1 transition-transform">
                  <CharAvatar name={c.name} url={c.avatar_url} size={46} />
                  <div className="min-w-0">
                    <div className="font-bold flex items-center gap-2 flex-wrap">
                      {c.name}
                      {c.status === 'draft' && (
                        <span className="kg-tag" style={{ background: '#fcebf0', color: '#a8455e' }}>草稿・尚未公開</span>
                      )}
                    </div>
                    {c.one_liner && <p className="text-sm text-[#6f6156] mt-0.5 line-clamp-2 leading-relaxed">{c.one_liner}</p>}
                  </div>
                </a>
                <div className="flex gap-2 mt-3">
                  <a href={href(`/p/${slug}/c/${c.id}/edit`)} className="kg-pill kg-pill-sm kg-pill-ghost">編輯</a>
                  <a href={href(`/p/${slug}/c/${c.id}/relations`)} className="kg-pill kg-pill-sm kg-pill-sage">牽線管理</a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ProjectShell>
  );
}
