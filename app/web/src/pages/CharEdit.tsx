import { useEffect, useRef, useState } from 'react';
import { getCharacter, listCharacters, updateCharacter, verifyCharToken, type CharacterView } from '../lib/api';
import { href } from '../lib/nav';
import { clearBuffer, loadBuffer, saveBuffer, useLeaveGuard } from '../lib/dirty';
import {
  BlocksEditor,
  ErrorBox,
  FillSection,
  ImageField,
  ImeInput,
  PageLoading,
  SecLabel,
  SheetableField,
  StickySaveBar,
  TagPicker,
  TokenGate,
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
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState(false);
  const [mode, setMode] = useState<BlockEditorMode>('fill');
  const [sec, setSec] = useState<'links' | 'fields' | 'tags' | ''>('fields');
  const [seedOpen, setSeedOpen] = useState<string | null>(null);
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

  const dirty = authed && snapshot.current !== '' && snapshot.current !== JSON.stringify(currentForm());

  useEffect(() => {
    (async () => {
      // 1-2：名單跟角色本身資料無關，先一起發出去，不用排在後面等
      const rosterPromise = listCharacters(slug);
      const got = await getCharacter(slug, charId);
      setData(got);
      if (!got) return;
      const ok = await verifyCharToken(slug, charId); // cookie 優先
      if (ok) {
        setAuthed(true);
        const snap: FormState = {
          name: ok.name, oneLiner: ok.one_liner, avatarUrl: ok.avatar_url ?? '', profile: ok.profile, blocks: ok.blocks ?? [], links: ok.links ?? [], tags: ok.tags ?? [],
        };
        serverForm.current = snap;
        snapshot.current = JSON.stringify(snap);
        applyChar(ok);
        const buf = loadBuffer<FormState>(BUF_KEY(charId));
        if (buf && buf.savedAt > ok.updated_at) {
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

  const doSave = async (): Promise<boolean> => {
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
      const res = await updateCharacter(slug, charId, '', {
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

  if (!authed) {
    // 權杖救回：清掉瀏覽器資料後，貼編輯碼即可重新取得編輯權（後端驗過會種 cookie）
    return (
      <ProjectShell slug={slug} title={data.project.title} active={null}>
        <div className="px-4 sm:px-6 py-16">
          <TokenGate
            title={`編輯「${data.character.name}」`}
            hint="貼上主辦或你自己保存的那串編輯碼。這台裝置驗證過就會記住。"
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
        </div>
      </ProjectShell>
    );
  }

  const { project } = data;

  return (
    <ProjectShell slug={slug} title={project.title} active={null}>
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
    </ProjectShell>
  );
}
