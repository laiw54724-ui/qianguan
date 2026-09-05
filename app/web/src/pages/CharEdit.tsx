import { useEffect, useRef, useState } from 'react';
import { getCharacter, listCharacters, shareCharUpdate, updateCharacter, type CharacterView } from '../lib/api';
import { href } from '../lib/nav';
import { clearBuffer, loadBuffer, saveBuffer, useLeaveGuard } from '../lib/dirty';
import {
  BlocksEditor,
  ErrorBox,
  FillSection,
  ImageField,
  ImeInput,
  PageLoading,
  SAVEBAR_HEIGHT,
  SecLabel,
  SHELL_NAV_HEIGHT,
  SheetableField,
  StickySaveBar,
  LoginPrompt,
  TagPicker,
  toast,
  type BlockEditorMode,
  type RosterLite,
} from '../components/kg';
import { SocialLinksEditor } from '../components/links';
import { fieldHasContent } from '../lib/fvals';
import { sanitizeLinks, type SocialLink } from '../lib/links';
import { ProjectShell } from '../components/project-shell';
import type { WorldBlock } from '../lib/types';

const BUF_KEY = (charId: string) => `draft_${charId}`; // kg_buf_draft_<charId>，對齊規格 §12 的 kg_draft_<charId> 語意

interface FormState {
  name: string;
  oneLiner: string;
  avatarUrl: string;
  profile: Record<string, string>;
  blocks: WorldBlock[];
  links: SocialLink[];
  tags: string[];
}

export default function CharEditPage({ slug, charId }: { slug: string; charId: string }) {
  const [data, setData] = useState<CharacterView | null | undefined>(undefined);
  const [owner, setOwner] = useState<boolean | undefined>(undefined);
  const [roster, setRoster] = useState<RosterLite[]>([]);

  const [name, setName] = useState('');
  const [oneLiner, setOneLiner] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [profile, setProfile] = useState<Record<string, string>>({});
  const [blocks, setBlocks] = useState<WorldBlock[]>([]);
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState(false);
  const [mode, setMode] = useState<BlockEditorMode>('fill');
  const [sec, setSec] = useState<'links' | 'fields' | 'tags' | ''>('fields');
  const [seedOpen, setSeedOpen] = useState<string | null>(null);
  // 1-3：存檔後才問，不是存檔當下——「加入了」已經公開過一次，這裡只問後續的更新
  const [sharePrompt, setSharePrompt] = useState(false);
  const [shareNote, setShareNote] = useState('');
  const [sharing, setSharing] = useState(false);
  const snapshot = useRef('');
  const serverForm = useRef<FormState | null>(null);

  const currentForm = (): FormState => ({ name, oneLiner, avatarUrl, profile, blocks, links, tags });

  const applyChar = (c: { name: string; one_liner: string; avatar_url: string | null; profile: Record<string, string>; blocks: WorldBlock[]; links?: SocialLink[]; tags?: string[] }) => {
    setName(c.name);
    setOneLiner(c.one_liner);
    setAvatarUrl(c.avatar_url ?? '');
    setProfile({ ...c.profile });
    setBlocks(c.blocks ?? []);
    setLinks(c.links ?? []);
    setTags(c.tags ?? []);
  };

  const dirty = !!owner && snapshot.current !== '' && snapshot.current !== JSON.stringify(currentForm());

  useEffect(() => {
    (async () => {
      // 1-2：名單跟角色本身資料無關，先一起發出去，不用排在後面等
      const rosterPromise = listCharacters(slug);
      const got = await getCharacter(slug, charId);
      setData(got);
      if (!got) return;
      setOwner(got.viewer.owned);
      if (got.viewer.owned) {
        const snap: FormState = {
          name: got.character.name, oneLiner: got.character.one_liner, avatarUrl: got.character.avatar_url ?? '',
          profile: got.character.profile, blocks: got.character.blocks ?? [], links: got.character.links ?? [], tags: got.character.tags ?? [],
        };
        serverForm.current = snap;
        snapshot.current = JSON.stringify(snap);
        applyChar(got.character);
        const buf = loadBuffer<FormState>(BUF_KEY(charId));
        if (buf && buf.savedAt > got.character.updated_at) {
          applyChar({
            name: buf.data.name,
            one_liner: buf.data.oneLiner,
            avatar_url: buf.data.avatarUrl,
            profile: buf.data.profile,
            blocks: buf.data.blocks,
            links: buf.data.links,
            tags: buf.data.tags,
          });
          setDraftNotice(true);
        }
      }
      const cs = await rosterPromise;
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
  }, [dirty, name, oneLiner, avatarUrl, profile, blocks, links, tags]);

  // 存檔進行中若又被叫一次（例如按了「儲存」還沒回來，使用者馬上又點連結想離開，
  // 離開確認跳出「儲存並離開」）——這裡原本完全沒擋，會真的送出兩個並發的 PATCH；
  // 改成把同一個進行中的 Promise 分享給後來的呼叫端，讓大家等的都是同一次真正的
  // 存檔結果，也不會讓 useLeaveGuard 把「還在存」誤判成「存檔失敗」。
  const savingPromise = useRef<Promise<boolean> | null>(null);

  const doSave = (): Promise<boolean> => {
    if (savingPromise.current) return savingPromise.current;
    const p = doSaveInner().finally(() => {
      savingPromise.current = null;
    });
    savingPromise.current = p;
    return p;
  };

  const doSaveInner = async (): Promise<boolean> => {
    if (!data) return false;
    setError(null);
    if (!name.trim()) {
      setError('請填角色名稱');
      return false;
    }
    for (const g of data.project.tag_groups ?? []) {
      if (g.required && !g.tags.some((t) => tags.includes(t))) {
        setError(`請選擇「${g.name}」`);
        return false;
      }
    }
    for (const f of data.project.field_schema) {
      if (f.required && !(profile[f.key] ?? '').trim()) {
        setError(`「${f.label}」為必填欄位`);
        return false;
      }
    }
    setBusy(true);
    try {
      const res = await updateCharacter(slug, charId, {
        name: name.trim(),
        one_liner: oneLiner.trim(),
        avatar_url: avatarUrl.trim(),
        profile,
        tags,
        links: sanitizeLinks(links),
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
      serverForm.current = currentForm();
      setDraftNotice(false);
      toast('✓ 已儲存，角色頁現在是新內容');
      const got = await getCharacter(slug, charId);
      if (got) setData(got);
      // 1-3／Ticket-11：加入當下就已經自動發過 char_joined，不用再問；
      // 「加入」跟「存檔」現在是兩個獨立時刻，每次存檔都問要不要順便說一聲，預設不問就是不發。
      setSharePrompt(true);
      return true;
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : '儲存失敗，請稍後再試');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const doShare = async () => {
    setSharing(true);
    try {
      const res = await shareCharUpdate(slug, charId, shareNote.trim());
      if (!res.ok) {
        toast(res.error, 'err');
        return;
      }
      toast('✓ 已經跟大家說一聲了');
      setSharePrompt(false);
      setShareNote('');
    } finally {
      setSharing(false);
    }
  };

  useLeaveGuard(dirty, doSave);

  if (data === undefined) {
    return (
      <ProjectShell slug={slug} title="" active={null}>
        <PageLoading text="正在打開角色卡…" />
      </ProjectShell>
    );
  }
  if (data === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="font-display font-black text-4xl">查無此角色</div>
      </div>
    );
  }

  if (owner === false) {
    return (
      <ProjectShell slug={slug} title={data.project.title} iconUrl={data.project.icon_url} active={null}>
        <div className="px-4 sm:px-6 py-16">
          <LoginPrompt title={`編輯「${data.character.name}」`} hint="這是這隻角色本人專屬的頁面。用建立這隻角色時的同一個 Discord 帳號登入即可編輯。" />
        </div>
      </ProjectShell>
    );
  }

  const { project } = data;

  return (
    <ProjectShell slug={slug} title={project.title} iconUrl={project.icon_url} active={null}>
      <div className="kg-form-page mx-auto max-w-2xl px-4 sm:px-6 py-10 w-full">
        <a href={href(`/p/${slug}/c/${charId}`)} className="font-mono2 text-xs text-[#6f6156] hover:text-[#9e4b2c]">
          ← 回角色頁
        </a>
        <div className="mt-4 mb-6">
          <div className="flex flex-wrap items-center gap-3">
            <SecLabel>編輯角色</SecLabel>
            <div className="kg-seg ml-auto" role="tablist" aria-label="編輯模式">
              <button type="button" role="tab" aria-selected={mode === 'fill'} aria-pressed={mode === 'fill'} onClick={() => setMode('fill')}>
                填寫
              </button>
              <button type="button" role="tab" aria-selected={mode === 'schema'} aria-pressed={mode === 'schema'} onClick={() => setMode('schema')}>
                組版
              </button>
            </div>
          </div>
          <h1 className="font-display font-black text-4xl mt-2">{name || data.character.name}</h1>
          <p className="font-mono2 text-[11px] text-[#6f6156] mt-1.5">
            {mode === 'fill' ? '只填已有欄位。要加區塊或改型別，點「組版」。' : '加區塊、改型別、排序。填內容請回到「填寫」。'}
          </p>
        </div>

        {data.character.status === 'draft' && (
          <div className="rounded-xl border-2 border-[#e8dfd4] px-4 py-3 text-sm font-bold mb-6" style={{ background: '#7fc0dc33' }}>
            這是一張還沒完成的角色卡——填好內容後按「儲存」，「{data.character.name}」就會正式加入企劃並出現在名單與動態牆。
          </div>
        )}

        {draftNotice && (
          <div className="kg-card-flat p-3 mb-6 flex flex-wrap items-center gap-3" style={{ background: '#7fc0dc22' }}>
            <span className="text-sm font-bold">已還原本機未儲存的草稿</span>
            <button
              type="button"
              className="kg-pill kg-pill-ghost kg-pill-sm min-h-10"
              onClick={() => {
                const s = serverForm.current;
                if (!s) return;
                applyChar({
                  name: s.name,
                  one_liner: s.oneLiner,
                  avatar_url: s.avatarUrl,
                  profile: s.profile,
                  blocks: s.blocks,
                  links: s.links,
                  tags: s.tags,
                });
                snapshot.current = JSON.stringify(s);
                clearBuffer(BUF_KEY(charId));
                setDraftNotice(false);
              }}
            >
              改回上次儲存
            </button>
          </div>
        )}

        {mode === 'fill' ? (
          <div className="space-y-3 kg-rise">
            <div className="kg-card-flat p-4">
              <div className="flex gap-3 items-start">
                <div className="shrink-0">
                  <ImageField label="頭像" value={avatarUrl} onChange={setAvatarUrl} square />
                </div>
                <div className="flex-1 min-w-0 space-y-3">
                  <div>
                    <label htmlFor="fld-CharEdit-1" className="kg-label">
                      角色名稱 <span className="req">*</span>
                    </label>
                    <ImeInput id="fld-CharEdit-1" className="kg-input" value={name} onChange={setName} maxLength={30} />
                  </div>
                  <div>
                    <label htmlFor="fld-CharEdit-2" className="kg-label">一句話介紹</label>
                    <ImeInput id="fld-CharEdit-2" className="kg-input" value={oneLiner} onChange={setOneLiner} placeholder="名單上顯示的一行" maxLength={80} />
                  </div>
                </div>
              </div>
            </div>

            {(project.tag_groups ?? []).length > 0 && (
              <FillSection
                title="分類"
                meta={`${tags.length}`}
                open={sec === 'tags'}
                onToggle={() => setSec(sec === 'tags' ? '' : 'tags')}
              >
                <TagPicker groups={project.tag_groups ?? []} value={tags} onChange={setTags} />
              </FillSection>
            )}

            <FillSection
              title="連結"
              meta={`${sanitizeLinks(links).length}`}
              open={sec === 'links'}
              onToggle={() => setSec(sec === 'links' ? '' : 'links')}
            >
              <SocialLinksEditor value={links} onChange={setLinks} hideIntro />
            </FillSection>

            {project.field_schema.length > 0 && (
              <FillSection
                title="企劃欄位"
                meta={`${project.field_schema.filter((f) => fieldHasContent(f.type ?? 'text', profile[f.key] ?? '')).length}/${project.field_schema.length}`}
                open={sec === 'fields'}
                onToggle={() => setSec(sec === 'fields' ? '' : 'fields')}
              >
                {project.field_schema.map((f) => (
                  <div key={f.key}>
                    <label className="kg-label" htmlFor={`pf-${f.key}`}>
                      {f.label} {f.required && <span className="req">*</span>}
                      {(f.visibility ?? 'public') === 'private' && (
                        <span className="ml-1.5 font-mono2 text-[10px] text-[#a8455e] font-normal">🔒 私人</span>
                      )}
                    </label>
                    <SheetableField
                      id={`pf-${f.key}`}
                      def={f}
                      value={profile[f.key] ?? ''}
                      onChange={(v) => setProfile({ ...profile, [f.key]: v })}
                      roster={roster}
                    />
                  </div>
                ))}
              </FillSection>
            )}

            <div className="pt-1">
              <div className="kg-seclabel mb-2">（角色卡）</div>
              <BlocksEditor
                value={blocks}
                onChange={setBlocks}
                roster={roster}
                slug={slug}
                mode="fill"
                variant="character"
                seedOpenId={seedOpen}
                onRequestSchema={() => setMode('schema')}
              />
            </div>

            {error && <ErrorBox>{error}</ErrorBox>}
          </div>
        ) : (
          <div className="space-y-4 kg-rise">
            <p className="text-sm text-[#6f6156] leading-relaxed">
              從模板加一塊，或空白開始。加完會回到填寫。填內容請回到「填寫」。
            </p>
            <BlocksEditor
              value={blocks}
              onChange={setBlocks}
              roster={roster}
              slug={slug}
              mode="schema"
              variant="character"
              onAdded={(id) => {
                setSeedOpen(id);
                setMode('fill');
              }}
            />
            {error && <ErrorBox>{error}</ErrorBox>}
          </div>
        )}
      </div>
      <StickySaveBar inShell dirty={dirty} busy={busy} onSave={() => { void doSave(); }} />
      {sharePrompt && (
        <div
          className="fixed inset-x-0 z-40 flex justify-center px-4"
          style={{ bottom: `calc(${SHELL_NAV_HEIGHT + SAVEBAR_HEIGHT}px + env(safe-area-inset-bottom) + 8px)` }}
        >
          <div className="kg-card w-full max-w-md p-4 flex flex-wrap items-center gap-3">
            <span className="text-sm font-bold shrink-0">要不要跟大家說一聲？</span>
            <input
              className="kg-input flex-1 min-w-[10rem]"
              value={shareNote}
              onChange={(e) => setShareNote(e.target.value)}
              placeholder="例：補了背景故事"
              maxLength={140}
              autoFocus
            />
            <div className="flex gap-2 ml-auto">
              <button type="button" className="kg-pill kg-pill-sm kg-pill-ghost" onClick={() => { setSharePrompt(false); setShareNote(''); }}>
                不用了
              </button>
              <button
                type="button"
                className="kg-pill kg-pill-sm kg-pill-red"
                disabled={!shareNote.trim() || sharing}
                onClick={() => { void doShare(); }}
              >
                {sharing ? '送出中…' : '分享這次更新'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ProjectShell>
  );
}
