import { useState } from 'react';
import { createProject, findSimilarProjects } from '../lib/api';
import { href, navigate } from '../lib/nav';
import {
  ChoiceSeg,
  ErrorBox,
  ImageField,
  ImeInput,
  SecLabel,
  SiteFooter,
  SiteHeader,
  StickySaveBar,
} from '../components/kg';
import { SocialLinksEditor } from '../components/links';
import { sanitizeLinks, type SocialLink } from '../lib/links';
import type { Project } from '../lib/types';

export default function NewProject() {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [iconUrl, setIconUrl] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'unlisted'>('unlisted');
  const [joinMode, setJoinMode] = useState<'open' | 'code'>('open');
  const [joinCode, setJoinCode] = useState('');
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [similar, setSimilar] = useState<Project[] | null>(null);
  const [forceCreate, setForceCreate] = useState(false);
  const [created, setCreated] = useState<Project | null>(null);

  const submit = async () => {
    setError(null);
    const live = title.trim();
    if (!live) return setError('請填企劃名稱');
    if (joinMode === 'code' && !joinCode.trim()) return setError('加入模式選了「需要加入碼」，請設定加入碼');
    setBusy(true);
    try {
      if (!forceCreate) {
        const sim = await findSimilarProjects(live);
        if (sim.length > 0) {
          setSimilar(sim);
          setBusy(false);
          return;
        }
      }
      const result = await createProject({
        title: live,
        summary,
        cover_url: coverUrl,
        icon_url: iconUrl,
        visibility,
        join_mode: joinMode,
        join_code: joinCode,
        links: sanitizeLinks(links),
      });
      setCreated(result.project);
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
            <SecLabel>企劃已建立</SecLabel>
            <h1 className="font-display font-black text-4xl mt-2">「{created.title}」</h1>
          </div>
          <div className="kg-card p-6 sm:p-8 kg-rise flex flex-wrap gap-3">
            <a href={href(`/p/${created.slug}`)} className="kg-pill">
              前往企劃頁 →
            </a>
            <a href={href(`/p/${created.slug}/manage`)} className="kg-pill kg-pill-ink">
              進入開設者後台
            </a>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="kg-form-page mx-auto max-w-2xl px-4 sm:px-6 py-14 w-full">
        <SecLabel>建立企劃</SecLabel>
        <h1 className="font-display font-black text-4xl mt-2 mb-8">開一個新企劃</h1>

        {similar && similar.length > 0 && (
          <div className="kg-card-flat p-5 mb-6 border-[#a8455e]" style={{ background: '#7fc0dc55' }}>
            <div className="font-bold mb-2">已經有人開過類似的企劃，要加入嗎？</div>
            <ul className="space-y-2 mb-4">
              {similar.map((p) => (
                <li key={p.id}>
                  <a href={href(`/p/${p.slug}`)} className="text-[#9e4b2c] font-bold underline">
                    {p.title}
                  </a>
                  <span className="font-mono2 text-xs text-[#6f6156] ml-2">/p/{p.slug}</span>
                </li>
              ))}
            </ul>
            <button type="button" className="kg-pill kg-pill-sm min-h-11" onClick={() => { setSimilar(null); setForceCreate(true); }}>
              都不是，我還是要開新的
            </button>
          </div>
        )}

        <div className="kg-card p-5 sm:p-8 space-y-5 kg-rise">
          <div>
            <label htmlFor="fld-NewProject-1" className="kg-label">
              企劃名稱 <span className="req">*</span>
            </label>
            <ImeInput id="fld-NewProject-1" className="kg-input" value={title} onChange={setTitle} placeholder="例：霧港夜航" maxLength={40} autoComplete="off" />
          </div>

          <div>
            <label htmlFor="fld-NewProject-2" className="kg-label">一句話簡介</label>
            <ImeInput id="fld-NewProject-2" className="kg-input" value={summary} onChange={setSummary} placeholder="一句話說明這個世界" maxLength={80} />
          </div>

          <div className="space-y-4">
            <div>
              <label className="kg-label">能見度</label>
              <ChoiceSeg
                ariaLabel="能見度"
                value={visibility}
                onChange={setVisibility}
                options={[
                  { value: 'unlisted', label: '未列出' },
                  { value: 'public', label: '公開' },
                ]}
              />
              <p className="font-mono2 text-[11px] text-[#6f6156] mt-1.5">
                {visibility === 'public' ? '會出現在首頁列表。' : '只有拿到網址的人能進。'}
              </p>
            </div>
            <div>
              <label className="kg-label">加入方式</label>
              <ChoiceSeg
                ariaLabel="加入方式"
                value={joinMode}
                onChange={setJoinMode}
                options={[
                  { value: 'open', label: '自由加入' },
                  { value: 'code', label: '需要加入碼' },
                ]}
              />
              {joinMode === 'code' && (
                <ImeInput
                  className="kg-input font-mono2 mt-3"
                  value={joinCode}
                  onChange={setJoinCode}
                  placeholder="設定加入碼"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              )}
            </div>
          </div>

          <hr className="kg-hr" />
          <div className="flex gap-3 items-start">
            <div className="flex-1 min-w-0">
              <ImageField label="封面（選填）" value={coverUrl} onChange={setCoverUrl} compact />
            </div>
            <div className="shrink-0">
              <ImageField label="頭像" value={iconUrl} onChange={setIconUrl} square compact />
            </div>
          </div>

          <SocialLinksEditor value={links} onChange={setLinks} />

          {error && <ErrorBox>{error}</ErrorBox>}
          <button type="button" className="kg-pill kg-pill-ghost" onClick={() => navigate('/home')}>
            取消
          </button>
        </div>
      </main>
      <SiteFooter />
      <StickySaveBar
        dirty={!!title.trim() && !busy}
        busy={busy}
        onSave={() => { void submit(); }}
        saveLabel="建立企劃"
        status={title.trim() ? '可以建立' : '先填企劃名稱'}
      />
    </div>
  );
}
