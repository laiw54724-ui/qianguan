import { useEffect, useState } from 'react';
import { getProject, joinProject, listCharacters } from '../lib/api';
import { addMyChar } from '../lib/session';
import { href } from '../lib/nav';
import { PageLoading, ErrorBox, toast, ImageField, ImeInput, SecLabel, SheetableField, StickySaveBar, TagPicker, type RosterLite } from '../components/kg';
import { SocialLinksEditor } from '../components/links';
import { sanitizeLinks, type SocialLink } from '../lib/links';
import { ProjectShell } from '../components/project-shell';
import type { Character, Project } from '../lib/types';

export default function JoinPage({ slug }: { slug: string }) {
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [roster, setRoster] = useState<RosterLite[]>([]);
  const [name, setName] = useState('');
  const [oneLiner, setOneLiner] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [profile, setProfile] = useState<Record<string, string>>({});
  const [tags, setTags] = useState<string[]>([]);
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ character: Character } | null>(null);

  useEffect(() => {
    getProject(slug).then((p) => setProject(p ?? null));
    listCharacters(slug).then((cs) => {
      setRoster(cs.map((c) => ({ id: c.id, name: c.name, avatar_url: c.avatar_url })));
    });
  }, [slug]);

  if (project === undefined) return (
    <ProjectShell slug={slug} title="" active={null}>
      <PageLoading />
    </ProjectShell>
  );
  if (project === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="font-display font-black text-4xl">查無此企劃</div>
      </div>
    );
  }

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError('請填角色名稱');
    for (const g of project.tag_groups ?? []) {
      if (g.required && !g.tags.some((t) => tags.includes(t))) return setError(`請選擇「${g.name}」`);
    }
    for (const f of project.field_schema) {
      if (f.required && !(profile[f.key] ?? '').trim()) return setError(`「${f.label}」為必填欄位`);
    }
    if (project.join_mode === 'code' && !joinCode.trim()) return setError('此企劃需要加入碼');
    setBusy(true);
    try {
      const res = await joinProject(slug, {
        name,
        one_liner: oneLiner,
        avatar_url: avatarUrl,
        profile,
        tags,
        links: sanitizeLinks(links),
        join_code: joinCode,
      });
      if (!res.ok) return setError(res.error);
      addMyChar({ slug, projectTitle: project.title, charId: res.character.id, name: res.character.name });
      toast(`「${res.character.name}」已加入企劃`);
      setCreated(res);
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <ProjectShell slug={slug} title={project.title} active={null}>
        <div className="mx-auto max-w-xl px-4 sm:px-6 py-16 w-full">
          <div className="mb-6">
            <SecLabel>歡迎登船</SecLabel>
            <h1 className="font-display font-black text-4xl mt-2">「{created.character.name}」已加入 {project.title}</h1>
            <p className="font-mono2 text-sm text-[#6f6156] mt-2">公開短碼：{created.character.id}（貼在 Discord 用這個）</p>
          </div>
          <div className="kg-card p-6 sm:p-8 kg-rise flex flex-wrap gap-3">
            <a href={href(`/p/${slug}/c/${created.character.id}`)} className="kg-pill">
              前往角色頁 →
            </a>
            <a href={href(`/p/${slug}/c/${created.character.id}/relations`)} className="kg-pill kg-pill-ink">
              開始牽線
            </a>
          </div>
        </div>
      </ProjectShell>
    );
  }

  return (
    <ProjectShell slug={slug} title={project.title} active={null}>
      <div className="kg-form-page mx-auto max-w-2xl px-4 sm:px-6 py-14 w-full">
        <SecLabel>加入企劃</SecLabel>
        <h1 className="font-display font-black text-4xl mt-2 mb-2">
          建立角色卡 <span className="text-[#6f6156] text-2xl">／ {project.title}</span>
        </h1>
        {!project.signups_open && (
          <div className="mt-4">
            <ErrorBox>此企劃已關閉報名。</ErrorBox>
          </div>
        )}

        <div className="space-y-4 mt-8 kg-rise">
          <div className="kg-card-flat p-4">
            <div className="flex gap-3 items-start">
              <div className="shrink-0">
                <ImageField label="頭像（選填）" value={avatarUrl} onChange={setAvatarUrl} square />
              </div>
              <div className="flex-1 min-w-0 space-y-3">
                <div>
                  <label htmlFor="fld-Join-1" className="kg-label">
                    角色名稱 <span className="req">*</span>
                  </label>
                  <ImeInput
                    id="fld-Join-1"
                    className="kg-input"
                    value={name}
                    onChange={setName}
                    maxLength={30}
                  />
                </div>
                <div>
                  <label htmlFor="fld-Join-2" className="kg-label">一句話介紹</label>
                  <ImeInput id="fld-Join-2" className="kg-input" value={oneLiner} onChange={setOneLiner} placeholder="名單上顯示的一行介紹" maxLength={80} />
                </div>
              </div>
            </div>
          </div>

          {(project.tag_groups ?? []).length > 0 && (
            <div className="kg-card-flat p-4">
              <TagPicker groups={project.tag_groups ?? []} value={tags} onChange={setTags} />
            </div>
          )}

          {project.field_schema.length > 0 && (
            <div className="kg-card-flat p-4 space-y-4">
              <div className="kg-seclabel">（企劃欄位）</div>
              {project.field_schema.map((f) => (
                <div key={f.key}>
                  <label htmlFor={`join-f-${f.key}`} className="kg-label">
                    {f.label} {f.required && <span className="req">*</span>}
                    {(f.visibility ?? 'public') === 'private' && (
                      <span className="ml-1.5 font-mono2 text-[10px] text-[#a8455e] font-normal">🔒 私人</span>
                    )}
                  </label>
                  <SheetableField
                    id={`join-f-${f.key}`}
                    def={f}
                    value={profile[f.key] ?? ''}
                    onChange={(v) => setProfile({ ...profile, [f.key]: v })}
                    roster={roster}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="kg-card-flat p-4">
            <SocialLinksEditor value={links} onChange={setLinks} />
          </div>

          {project.join_mode === 'code' && (
            <div className="kg-card-flat p-4">
              <label htmlFor="fld-Join-code" className="kg-label">
                加入碼 <span className="req">*</span>
              </label>
              <input id="fld-Join-code" className="kg-input font-mono2" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="向主辦索取" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            </div>
          )}

          {error && <ErrorBox>{error}</ErrorBox>}
        </div>
      </div>
      <StickySaveBar
        inShell
        dirty={!!name.trim() && project.signups_open && !busy}
        busy={busy}
        onSave={() => { void submit(); }}
        saveLabel="建立角色卡"
        status={name.trim() ? '可以建立' : '先填角色名稱'}
      />
    </ProjectShell>
  );
}
