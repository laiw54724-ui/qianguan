import { useEffect, useState } from 'react';
import { getDashboard, getMe, type DashboardCharacter, type DashboardData } from '../lib/api';
import { href } from '../lib/nav';
import { CharAvatar, EmptyNote, PageLoading, SiteFooter, SiteHeader } from '../components/kg';

export default function DashboardPage() {
  const [me, setMe] = useState<string | null | undefined>(undefined);
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    (async () => {
      const discordId = await getMe();
      setMe(discordId);
      if (!discordId) return;
      setData(await getDashboard());
    })();
  }, []);

  if (me === undefined) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <PageLoading />
        <SiteFooter />
      </div>
    );
  }

  if (me === null) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="mx-auto max-w-md px-4 py-24 text-center flex-1">
          <h1 className="font-huninn text-3xl mb-4">用 Discord 登入</h1>
          <p className="text-sm text-[#6f6156] mb-6">登入後這裡會列出你開設的企劃與你的所有角色。</p>
          <a href={`/api/auth/discord/login?next=${encodeURIComponent('/dashboard')}`} className="kg-pill kg-pill-red">
            用 Discord 登入
          </a>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const grouped = new Map<string, { title: string; chars: DashboardCharacter[] }>();
  for (const c of data?.characters ?? []) {
    const g = grouped.get(c.project_slug) ?? { title: c.project_title, chars: [] };
    g.chars.push(c);
    grouped.set(c.project_slug, g);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-12 w-full flex-1">
        <h1 className="font-huninn text-3xl mb-8">我的總覽</h1>

        <section className="mb-10">
          <h2 className="font-huninn text-xl mb-4">我開設的企劃</h2>
          {!data || data.owned_projects.length === 0 ? (
            <EmptyNote>還沒開過企劃。</EmptyNote>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {data.owned_projects.map((p) => (
                <a key={p.id} href={href(`/p/${p.slug}/manage`)} className="kg-card p-4 flex gap-3 items-center hover:-translate-y-1 transition-transform">
                  <CharAvatar name={p.title} url={p.icon_url} size={44} />
                  <div className="min-w-0">
                    <div className="font-bold">{p.title}</div>
                    {p.summary && <p className="text-sm text-[#6f6156] line-clamp-1">{p.summary}</p>}
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="font-huninn text-xl mb-4">我的角色</h2>
          {grouped.size === 0 ? (
            <EmptyNote>還沒有角色。</EmptyNote>
          ) : (
            [...grouped.entries()].map(([slug, g]) => (
              <div key={slug} className="mb-6">
                <div className="kg-seclabel mb-2">（{g.title}）</div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {g.chars.map((c) => (
                    <a key={c.id} href={href(`/p/${slug}/c/${c.id}`)} className="kg-card p-4 flex gap-3 items-start hover:-translate-y-1 transition-transform">
                      <CharAvatar name={c.name} url={c.avatar_url} size={44} />
                      <div className="min-w-0">
                        <div className="font-bold flex items-center gap-2 flex-wrap">
                          {c.name}
                          {c.status === 'draft' && (
                            <span className="kg-tag" style={{ background: '#fcebf0', color: '#a8455e' }}>草稿</span>
                          )}
                        </div>
                        {c.one_liner && <p className="text-sm text-[#6f6156] line-clamp-1">{c.one_liner}</p>}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            ))
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
