import { useEffect, useState } from 'react';
import { getProject, joinProject, listCharacters } from '../lib/api';
import { addMyChar } from '../lib/session';
import { href } from '../lib/nav';
import { PageLoading, ErrorBox, toast, FieldInput, ImageField, SecLabel, SiteFooter, SiteHeader, TokenReveal, TurnstileWidget, type RosterLite } from '../components/kg';
import type { Character, Project } from '../lib/types';

export default function JoinPage({ slug }: { slug: string }) {
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [roster, setRoster] = useState<RosterLite[]>([]);
  const [name, setName] = useState('');
  const [oneLiner, setOneLiner] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [profile, setProfile] = useState<Record<string, string>>({});
  const [joinCode, setJoinCode] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ character: Character; charToken: string } | null>(null);

  useEffect(() => {
    getProject(slug).then((p) => setProject(p ?? null));
    listCharacters(slug).then((cs) => setRoster(cs.map((c) => ({ id: c.id, name: c.name, avatar_url: c.avatar_url }))));
  }, [slug]);

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
        <SiteHeader />
        <main className="flex-1 flex items-center justify-center">
          <div className="font-display font-black text-4xl">查無此企劃</div>
        </main>
      </div>
    );
  }

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError('請填角色名稱');
    for (const f of project.field_schema) {
      if (f.required && !(profile[f.key] ?? '').trim()) return setError(`「${f.label}」為必填欄位`);
    }
    if (project.join_mode === 'code' && !joinCode.trim()) return setError('此企劃需要加入碼');
    if (!turnstileToken) return setError('請先完成真人驗證');
    setBusy(true);
    try {
      const res = await joinProject(slug, { name, one_liner: oneLiner, avatar_url: avatarUrl, profile, join_code: joinCode, turnstile: turnstileToken });
      if (!res.ok) return setError(res.error);
      // charToken 只顯示這一次；cookie 已由後端種好（§4.2）
      addMyChar({ slug, projectTitle: project.title, charId: res.character.id, name: res.character.name });
      toast(`「${res.character.name}」已加入企劃`);
      setCreated(res);
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="mx-auto max-w-xl px-4 sm:px-6 py-16 w-full">
          <div className="mb-6">
            <SecLabel>歡迎登船</SecLabel>
            <h1 className="font-display font-black text-4xl mt-2">「{created.character.name}」已加入 {project.title}</h1>
            <p className="font-mono2 text-sm text-[#6f6156] mt-2">公開短碼：{created.character.id}（貼在 Discord 用這個）</p>
          </div>
          <TokenReveal
            kind="char"
            token={created.charToken}
            note="公開短碼可以公開；編輯碼是祕密。兩者混在一起等於把編輯權公開。"
          >
            <a href={href(`/p/${slug}/c/${created.character.id}`)} className="kg-pill">
              前往角色頁 →
            </a>
            <a href={href(`/p/${slug}/c/${created.character.id}/relations`)} className="kg-pill kg-pill-ink">
              開始牽線
            </a>
          </TokenReveal>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 sm:px-6 py-14 w-full">
        <SecLabel>加入企劃</SecLabel>
        <h1 className="font-display font-black text-4xl mt-2 mb-2">
          建立角色卡 <span className="text-[#6f6156] text-2xl">／ {project.title}</span>
        </h1>
        {!project.signups_open && (
          <div className="mt-4">
            <ErrorBox>此企劃已關閉報名。</ErrorBox>
          </div>
        )}

        <div className="kg-card p-6 sm:p-8 space-y-5 mt-8 kg-rise">
          <div className="grid sm:grid-cols-2 gap-5 items-start">
            <div>
              <label htmlFor="fld-Join-1" className="kg-label">
                角色名稱 <span className="req">*</span>
              </label>
              <input id="fld-Join-1" className="kg-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
            </div>
            <ImageField label="頭像（選填）" value={avatarUrl} onChange={setAvatarUrl} hint="不上傳的話會自動生成色塊頭像。" square />
          </div>
          <div>
            <label htmlFor="fld-Join-2" className="kg-label">一句話介紹</label>
            <input id="fld-Join-2" className="kg-input" value={oneLiner} onChange={(e) => setOneLiner(e.target.value)} placeholder="名單上顯示的一行介紹" maxLength={80} />
          </div>

          <hr className="kg-hr" />
          <div className="kg-seclabel">（企劃自訂欄位）</div>
          <div className="grid sm:grid-cols-2 gap-5">
            {project.field_schema.map((f) => (
              <div key={f.key} className={['textarea', 'tags', 'multiselect', 'checklist', 'radar', 'timeline', 'calendar', 'palette', 'image', 'audio', 'video', 'charref'].includes(f.type ?? 'text') ? 'sm:col-span-2' : ''}>
                <label htmlFor="fld-Join-3" className="kg-label">
                  {f.label} {f.required && <span className="req">*</span>}
                  {(f.visibility ?? 'public') === 'private' && (
                    <span className="ml-1.5 font-mono2 text-[10px] text-[#a8455e] font-normal">🔒 私人・僅本人與開設者可見</span>
                  )}
                </label>
                <FieldInput def={f} value={profile[f.key] ?? ''} onChange={(v) => setProfile({ ...profile, [f.key]: v })} roster={roster} />
              </div>
            ))}
          </div>

          {project.join_mode === 'code' && (
            <>
              <hr className="kg-hr" />
              <div>
                <label className="kg-label">
                  加入碼 <span className="req">*</span>
                </label>
                <input id="fld-Join-3" className="kg-input font-mono2" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="向主辦索取" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
              </div>
            </>
          )}

          <TurnstileWidget token={turnstileToken} onChange={setTurnstileToken} />
          {error && <ErrorBox>{error}</ErrorBox>}

          <button
            type="button"
            className="kg-pill kg-pill-red w-full justify-center"
            disabled={busy || !project.signups_open}
            onClick={submit}
          >
            {busy ? '建立中…' : '建立角色卡'}
          </button>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
