import { useEffect, useRef, useState } from 'react';
import { getCharacter, listCharacters, updateCharacter, verifyCharToken, type CharacterView } from '../lib/api';
import { href, navigate } from '../lib/nav';
import { clearBuffer, loadBuffer, saveBuffer, useLeaveGuard } from '../lib/dirty';
import { BlocksEditor, ErrorBox, FieldInput, ImageField, PageLoading, SecLabel, SiteFooter, SiteHeader, TokenGate, toast, type RosterLite } from '../components/kg';
import { fieldHasContent } from '../lib/fvals';
import type { WorldBlock } from '../lib/types';

const BUF_KEY = (charId: string) => `draft_${charId}`; // kg_buf_draft_<charId>，對齊規格 §12 的 kg_draft_<charId> 語意

interface FormState {
  name: string;
  oneLiner: string;
  avatarUrl: string;
  profile: Record<string, string>;
  blocks: WorldBlock[];
}

export default function CharEditPage({ slug, charId }: { slug: string; charId: string }) {
  const [data, setData] = useState<CharacterView | null | undefined>(undefined);
  const [authed, setAuthed] = useState(false);
  const [roster, setRoster] = useState<RosterLite[]>([]);
  const [gateToken, setGateToken] = useState('');
  const [gateError, setGateError] = useState<string | null>(null);
  const [gateBusy, setGateBusy] = useState(false);

  const [name, setName] = useState('');
  const [oneLiner, setOneLiner] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [profile, setProfile] = useState<Record<string, string>>({});
  const [blocks, setBlocks] = useState<WorldBlock[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restorable, setRestorable] = useState<FormState | null>(null);
  const snapshot = useRef('');

  const currentForm = (): FormState => ({ name, oneLiner, avatarUrl, profile, blocks });

  const applyChar = (c: { name: string; one_liner: string; avatar_url: string | null; profile: Record<string, string>; blocks: WorldBlock[] }) => {
    setName(c.name);
    setOneLiner(c.one_liner);
    setAvatarUrl(c.avatar_url ?? '');
    setProfile({ ...c.profile });
    setBlocks(c.blocks ?? []);
  };

  const dirty = authed && snapshot.current !== '' && snapshot.current !== JSON.stringify(currentForm());

  useEffect(() => {
    (async () => {
      const got = await getCharacter(slug, charId);
      setData(got);
      if (!got) return;
      const ok = await verifyCharToken(slug, charId); // cookie 優先
      if (ok) {
        setAuthed(true);
        applyChar(ok);
        snapshot.current = JSON.stringify({
          name: ok.name, oneLiner: ok.one_liner, avatarUrl: ok.avatar_url ?? '', profile: ok.profile, blocks: ok.blocks ?? [],
        });
        // 本機復原緩衝：比伺服器新就問（§12-6）
        const buf = loadBuffer<FormState>(BUF_KEY(charId));
        if (buf && buf.savedAt > ok.updated_at) setRestorable(buf.data);
      }
      const cs = await listCharacters(slug);
      setRoster(cs.filter((c) => c.id !== charId).map((c) => ({ id: c.id, name: c.name, avatar_url: c.avatar_url })));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, charId]);

  // 本機緩衝：未儲存的輸入每隔數秒寫一份（§12-2）
  useEffect(() => {
    if (!dirty) return;
    saveBuffer(BUF_KEY(charId), currentForm());
    const t = window.setInterval(() => saveBuffer(BUF_KEY(charId), currentForm()), 3000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, name, oneLiner, avatarUrl, profile, blocks]);

  const doSave = async (): Promise<boolean> => {
    if (!data) return false;
    setError(null);
    if (!name.trim()) {
      setError('請填角色名稱');
      return false;
    }
    for (const f of data.project.field_schema) {
      if (f.required && !(profile[f.key] ?? '').trim()) {
        setError(`「${f.label}」為必填欄位`);
        return false;
      }
    }
    setBusy(true);
    try {
      const res = await updateCharacter(slug, charId, '', {
        name: name.trim(),
        one_liner: oneLiner.trim(),
        avatar_url: avatarUrl.trim(),
        profile,
        blocks: blocks
          .map((b) => ({ ...b, title: b.title.trim() }))
          .filter((b) => b.title || b.fields.some((f) => fieldHasContent(f.type, f.content, f.images))),
      });
      if (!res.ok) {
        setError(res.error);
        return false;
      }
      clearBuffer(BUF_KEY(charId));
      snapshot.current = JSON.stringify(currentForm());
      toast('✓ 已儲存，角色頁現在是新內容');
      const got = await getCharacter(slug, charId);
      if (got) setData(got);
      return true;
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : '儲存失敗，請稍後再試');
      return false;
    } finally {
      setBusy(false);
    }
  };

  useLeaveGuard(dirty, doSave);

  if (data === undefined) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="flex-1">
          <PageLoading text="正在打開角色卡…" />
        </main>
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="flex-1 flex items-center justify-center">
          <div className="font-display font-black text-4xl">查無此角色</div>
        </main>
      </div>
    );
  }

  if (!authed) {
    // 權杖救回：清掉瀏覽器資料後，貼編輯碼即可重新取得編輯權（後端驗過會種 cookie）
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="flex-1 px-4 sm:px-6 py-16">
          <TokenGate
            title={`編輯「${data.character.name}」`}
            hint="需要角色編輯碼。若你換了瀏覽器或清掉了資料，貼上當初保存的 chr_ 權杖即可救回角色。"
            token={gateToken}
            setToken={setGateToken}
            busy={gateBusy}
            error={gateError}
            onSubmit={async () => {
              setGateBusy(true);
              setGateError(null);
              const ok = await verifyCharToken(slug, charId, gateToken);
              setGateBusy(false);
              if (!ok) return setGateError('企劃不存在或權杖錯誤');
              setAuthed(true);
              applyChar(ok);
              snapshot.current = JSON.stringify(currentForm());
            }}
          />
        </main>
        <SiteFooter />
      </div>
    );
  }

  const { project } = data;

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 sm:px-6 py-14 w-full">
        <a href={href(`/p/${slug}/c/${charId}`)} className="font-mono2 text-xs text-[#6f6156] hover:text-[#9e4b2c]">
          ← 回角色頁
        </a>
        <div className="mt-4 mb-8">
          <div className="flex flex-wrap items-center gap-3">
            <SecLabel>編輯角色</SecLabel>
            <div className="ml-auto flex items-center gap-2.5">
              {dirty && (
                <span className="kg-tag" style={{ background: '#f6efe4', color: '#9e4b2c' }}>
                  ● 有未儲存的變更
                </span>
              )}
              <button type="button" className="kg-pill kg-pill-red" disabled={!dirty || busy} onClick={doSave}>
                {busy ? '儲存中…' : '儲存'}
              </button>
            </div>
          </div>
          <h1 className="font-display font-black text-4xl mt-2">{data.character.name}</h1>
          <p className="font-mono2 text-[11px] text-[#6f6156] mt-1.5">變更只存在這個瀏覽器，按「儲存」才對所有人生效；離開前會問你要不要儲存。</p>
        </div>

        {data.character.status === 'draft' && (
          <div className="rounded-xl border-2 border-[#e8dfd4] px-4 py-3 text-sm font-bold mb-6" style={{ background: '#7fc0dc33' }}>
            這是一張還沒完成的角色卡——填好內容後按「儲存」，「{data.character.name}」就會正式加入企劃並出現在名單與動態牆。
          </div>
        )}

        {restorable && (
          <div className="kg-card-flat p-4 mb-6 flex flex-wrap items-center gap-3" style={{ background: '#7fc0dc22' }}>
            <span className="text-sm font-bold">上次有未儲存的變更，要復原嗎？</span>
            <button
              type="button"
              className="kg-pill kg-pill-sm"
              onClick={() => {
                applyChar({ name: restorable.name, one_liner: restorable.oneLiner, avatar_url: restorable.avatarUrl, profile: restorable.profile, blocks: restorable.blocks });
                setRestorable(null);
              }}
            >
              復原
            </button>
            <button
              type="button"
              className="kg-pill kg-pill-ghost kg-pill-sm"
              onClick={() => {
                clearBuffer(BUF_KEY(charId));
                setRestorable(null);
              }}
            >
              捨棄
            </button>
          </div>
        )}

        <div className="kg-card p-6 sm:p-8 space-y-5 kg-rise">
          <div className="grid sm:grid-cols-2 gap-5 items-start">
            <div>
              <label htmlFor="fld-CharEdit-1" className="kg-label">
                角色名稱 <span className="req">*</span>
              </label>
              <input id="fld-CharEdit-1" className="kg-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
            </div>
            <ImageField label="頭像" value={avatarUrl} onChange={setAvatarUrl} square />
          </div>
          <div>
            <label htmlFor="fld-CharEdit-2" className="kg-label">一句話介紹</label>
            <input id="fld-CharEdit-2" className="kg-input" value={oneLiner} onChange={(e) => setOneLiner(e.target.value)} maxLength={80} />
          </div>

          <hr className="kg-hr" />
          <div className="kg-seclabel">（企劃自訂欄位）</div>
          <div className="grid sm:grid-cols-2 gap-5">
            {project.field_schema.map((f) => (
              <div key={f.key} className={['textarea', 'tags', 'multiselect', 'checklist', 'radar', 'timeline', 'calendar', 'palette', 'image', 'audio', 'video', 'charref'].includes(f.type ?? 'text') ? 'sm:col-span-2' : ''}>
                <label className="kg-label" htmlFor={`pf-${f.key}`}>
                  {f.label} {f.required && <span className="req">*</span>}
                  {(f.visibility ?? 'public') === 'private' && (
                    <span className="ml-1.5 font-mono2 text-[10px] text-[#a8455e] font-normal">🔒 私人・僅本人與開設者可見</span>
                  )}
                </label>
                <FieldInput id={`pf-${f.key}`} def={f} value={profile[f.key] ?? ''} onChange={(v) => setProfile({ ...profile, [f.key]: v })} roster={roster} />
              </div>
            ))}
          </div>

          <hr className="kg-hr" />
          <div>
            <div className="kg-seclabel">（角色卡區塊）</div>
            <p className="text-sm text-[#6f6156] mt-2 mb-4 leading-relaxed">
              一個區塊裡可以放多個欄位，各自選型別（文字、標籤、核取清單、五維雷達、時間線、行事曆、色票、圖片相簿、PDF、音樂、影片、關聯角色…）。新增區塊可從模板開始；每個區塊都有「預覽」可以看到顯示效果。
            </p>
            <BlocksEditor value={blocks} onChange={setBlocks} roster={roster} slug={slug} />
          </div>

          {error && <ErrorBox>{error}</ErrorBox>}

          <div className="flex gap-3 items-center">
            <p className="text-xs text-[#6f6156] leading-relaxed flex-1">內容在按「儲存」前不會離開這個瀏覽器。</p>
            <button type="button" className="kg-pill kg-pill-ghost shrink-0" onClick={() => navigate(`/p/${slug}/c/${charId}`)}>
              回角色頁
            </button>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
