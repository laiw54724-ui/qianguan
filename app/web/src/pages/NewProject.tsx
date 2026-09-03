import { useState } from 'react';
import { createProject, findSimilarProjects } from '../lib/api';
import { href, navigate } from '../lib/nav';
import { ErrorBox, ImageField, SecLabel, SiteFooter, SiteHeader, TokenReveal, TurnstileWidget } from '../components/kg';
import type { Project } from '../lib/types';

export default function NewProject() {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [iconUrl, setIconUrl] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'unlisted'>('unlisted');
  const [joinMode, setJoinMode] = useState<'open' | 'code'>('open');
  const [joinCode, setJoinCode] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 重複企劃偵測（規格 §8.5）
  const [similar, setSimilar] = useState<Project[] | null>(null);
  const [forceCreate, setForceCreate] = useState(false);

  const [created, setCreated] = useState<{ project: Project; ownerToken: string } | null>(null);

  const submit = async () => {
    setError(null);
    if (!title.trim()) return setError('請填企劃名稱');
    if (joinMode === 'code' && !joinCode.trim()) return setError('加入模式選了「需要加入碼」，請設定加入碼');
    if (!turnstileToken) return setError('請先完成真人驗證');
    setBusy(true);
    try {
      if (!forceCreate) {
        const sim = await findSimilarProjects(title);
        if (sim.length > 0) {
          setSimilar(sim);
          setBusy(false);
          return;
        }
      }
      const result = await createProject({
        title,
        summary,
        cover_url: coverUrl,
        icon_url: iconUrl,
        visibility,
        join_mode: joinMode,
        join_code: joinCode,
        turnstile: turnstileToken,
      });
      // ownerToken 只顯示這一次；cookie 已由後端種好（§4.2）
      setCreated(result);
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
            <h1 className="font-display font-black text-4xl mt-2">「{created.project.title}」</h1>
          </div>
          <TokenReveal kind="owner" token={created.ownerToken} note="進入後台後可隨時修改企劃資訊；這組權杖也已存在此瀏覽器中。">
            <a href={href(`/p/${created.project.slug}`)} className="kg-pill">
              前往企劃頁 →
            </a>
            <a href={href(`/p/${created.project.slug}/manage`)} className="kg-pill kg-pill-ink">
              進入開設者後台
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
            <button type="button" className="kg-pill kg-pill-sm" onClick={() => { setSimilar(null); setForceCreate(true); }}>
              都不是，我還是要開新的
            </button>
          </div>
        )}

        <div className="kg-card p-6 sm:p-8 space-y-5 kg-rise">
          <div>
            <label htmlFor="fld-NewProject-1" className="kg-label">
              企劃名稱 <span className="req">*</span>
            </label>
            <input id="fld-NewProject-1" className="kg-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：霧港夜航" maxLength={40} autoComplete="off" />
          </div>

          <div>
            <label htmlFor="fld-NewProject-2" className="kg-label">一句話簡介</label>
            <input id="fld-NewProject-2" className="kg-input" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="港都懸疑 × 怪談，登上子夜的渡輪" maxLength={80} />
          </div>

          <hr className="kg-hr" />
          <div className="kg-seclabel">（先選封面圖和頭像）</div>
          <ImageField label="封面圖（選填）" value={coverUrl} onChange={setCoverUrl} hint="企劃頁頂部大圖，建議橫幅。可上傳或貼網址。" />
          <ImageField label="企劃頭像（選填）" value={iconUrl} onChange={setIconUrl} hint="列表與頁首用的小方圖。" square />
          <p className="font-mono2 text-xs text-[#6f6156]">＊ 世界觀不用現在寫——建立後到開設者後台，用「簡介／玩法／規則／地圖」區塊慢慢整理。</p>

          <div className="grid sm:grid-cols-2 gap-5">
            <div>
              <label className="kg-label">能見度</label>
              <div className="space-y-2">
                {(
                  [
                    ['unlisted', '未列出（有網址的人才能進，不被索引）'],
                    ['public', '公開（出現在首頁列表）'],
                  ] as const
                ).map(([v, label]) => (
                  <label key={v} className="flex items-start gap-2 text-sm cursor-pointer">
                    <input type="radio" name="vis" checked={visibility === v} onChange={() => setVisibility(v)} className="mt-0.5 accent-[#9e4b2c]" />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="kg-label">加入方式</label>
              <div className="space-y-2">
                {(
                  [
                    ['open', '自由加入'],
                    ['code', '需要加入碼（由你自行散布）'],
                  ] as const
                ).map(([v, label]) => (
                  <label key={v} className="flex items-start gap-2 text-sm cursor-pointer">
                    <input type="radio" name="jm" checked={joinMode === v} onChange={() => setJoinMode(v)} className="mt-0.5 accent-[#9e4b2c]" />
                    {label}
                  </label>
                ))}
              </div>
              {joinMode === 'code' && (
                <input
                  className="kg-input font-mono2 mt-3"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="設定加入碼"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              )}
            </div>
          </div>

          <TurnstileWidget token={turnstileToken} onChange={setTurnstileToken} />

          {error && <ErrorBox>{error}</ErrorBox>}

          <div className="flex gap-3 pt-1">
            <button type="button" className="kg-pill kg-pill-red flex-1 justify-center" disabled={busy} onClick={submit}>
              {busy ? '建立中…' : '建立企劃'}
            </button>
            <button type="button" className="kg-pill kg-pill-ghost" onClick={() => navigate('/home')}>
              取消
            </button>
          </div>
          <p className="font-mono2 text-xs text-[#6f6156]">
            ＊ 建立後會得到一組開設者碼（own_…），那是管理企劃的唯一憑證。世界觀區塊、QA、角色必填欄位都能之後在後台自訂。
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
