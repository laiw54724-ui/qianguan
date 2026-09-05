import { useEffect, useRef, useState } from 'react';
import { getProject, removeCharacter, rosterStats, updateProject, type RosterRow } from '../lib/api';
import { href, timeAgo } from '../lib/nav';
import { clearBuffer, loadBuffer, saveBuffer, useLeaveGuard } from '../lib/dirty';
import {
  BlocksEditor,
  CharAvatar,
  ChoiceSeg,
  ErrorBox,
  FieldsEditor,
  ImageField,
  ImeInput,
  PageLoading,
  QaEditor,
  SecLabel,
  StickySaveBar,
  TagGroupEditor,
  LoginPrompt,
  toast,
  type BlockEditorMode,
} from '../components/kg';
import { fieldHasContent } from '../lib/fvals';
import { SocialLinksEditor } from '../components/links';
import { sanitizeLinks, type SocialLink } from '../lib/links';
import { ProjectShell } from '../components/project-shell';
import type { FieldDef, Project, QaItem, TagGroup, WorldBlock } from '../lib/types';

const BUF_KEY = (slug: string) => `pbuf_${slug}`;

interface FormState {
  title: string;
  summary: string;
  coverUrl: string;
  iconUrl: string;
  visibility: 'public' | 'unlisted';
  joinMode: 'open' | 'code';
  joinCode: string;
  signupsOpen: boolean;
  worldBlocks: WorldBlock[];
  qa: QaItem[];
  fields: FieldDef[];
  tagGroups: TagGroup[];
  links: SocialLink[];
}

export default function ManagePage({ slug }: { slug: string }) {
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [owner, setOwner] = useState<boolean | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [iconUrl, setIconUrl] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'unlisted'>('unlisted');
  const [joinMode, setJoinMode] = useState<'open' | 'code'>('open');
  const [joinCode, setJoinCode] = useState('');
  const [signupsOpen, setSignupsOpen] = useState(true);
  const [worldBlocks, setWorldBlocks] = useState<WorldBlock[]>([]);
  const [qa, setQa] = useState<QaItem[]>([]);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([]);
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [worldMode, setWorldMode] = useState<BlockEditorMode>('fill');
  const [tab, setTab] = useState<'info' | 'world' | 'fields' | 'tags' | 'roster'>('info');
  const [seedOpen, setSeedOpen] = useState<string | null>(null);

  const [rows, setRows] = useState<RosterRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [restorable, setRestorable] = useState<FormState | null>(null); // 本機緩衝比伺服器新 → 問要不要復原
  const snapshot = useRef(''); // 上次載入/儲存時的狀態指纹

  const currentForm = (): FormState => ({
    title, summary, coverUrl, iconUrl, visibility, joinMode, joinCode, signupsOpen, worldBlocks, qa, fields, tagGroups, links,
  });

  const applyProject = (p: Project) => {
    setTitle(p.title);
    setSummary(p.summary);
    setCoverUrl(p.cover_url ?? '');
    setIconUrl(p.icon_url ?? '');
    setVisibility(p.visibility);
    setJoinMode(p.join_mode);
    setJoinCode(''); // 明文不留：留空＝沿用
    setSignupsOpen(p.signups_open);
    setWorldBlocks(p.world_blocks);
    setQa(p.qa);
    setFields(p.field_schema);
    setTagGroups(p.tag_groups ?? []);
    setLinks(p.links ?? []);
    setWorldMode(p.world_blocks.length ? 'fill' : 'schema');
  };

  const dirty = !!owner && snapshot.current !== '' && snapshot.current !== JSON.stringify({ ...currentForm(), joinCode: '' });

  const refresh = async () => {
    // 1-2：名單統計跟企劃本身資料無關，並行抓
    const [p, rows] = await Promise.all([getProject(slug), rosterStats(slug)]);
    setProject(p ?? null);
    if (p) setRows(rows);
  };

  useEffect(() => {
    (async () => {
      const rosterPromise = rosterStats(slug);
      const p = await getProject(slug);
      setProject(p ?? null);
      if (!p) return;
      setOwner(p.viewer.isOwner);
      if (p.viewer.isOwner) {
        applyProject(p);
        snapshot.current = JSON.stringify({ ...({
          title: p.title, summary: p.summary, coverUrl: p.cover_url ?? '', iconUrl: p.icon_url ?? '',
          visibility: p.visibility, joinMode: p.join_mode, joinCode: '', signupsOpen: p.signups_open,
          worldBlocks: p.world_blocks, qa: p.qa, fields: p.field_schema, tagGroups: p.tag_groups ?? [], links: p.links ?? [],
        }) });
        setRows(await rosterPromise);
        // 本機復原緩衝：比伺服器新就問（§12-6）
        const buf = loadBuffer<FormState>(BUF_KEY(slug));
        if (buf && buf.savedAt > p.updated_at) setRestorable(buf.data);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // 每隔數秒把未儲存的輸入寫進本機緩衝（§12-2）——這是備援，不是資料來源
  useEffect(() => {
    if (!dirty) return;
    const t = window.setInterval(() => saveBuffer(BUF_KEY(slug), currentForm()), 3000);
    saveBuffer(BUF_KEY(slug), currentForm());
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, title, summary, coverUrl, iconUrl, visibility, joinMode, joinCode, signupsOpen, worldBlocks, qa, fields, tagGroups, links]);

  // 存檔進行中若又被叫一次（例如按了「儲存」還沒回來，使用者馬上又點連結想離開，
  // 離開確認跳出「儲存並離開」）——不能直接回 false 假裝失敗：呼叫端（尤其
  // useLeaveGuard）會把 false 當成「存檔失敗」，讓使用者卡在「明明按過儲存」
  // 卻又被說沒存好的狀態。改成把同一個進行中的 Promise 分享給後來的呼叫端，
  // 讓大家等的都是同一次真正的存檔結果。
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
    if (!title.trim()) {
      setError('企劃名稱不能空白');
      return false;
    }
    if (joinMode === 'code' && !joinCode.trim() && !project?.has_join_code) {
      setError('加入方式選了「需要加入碼」，請設定加入碼——不設的話會沒有人能加入');
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await updateProject(slug, {
        title: title.trim(),
        summary: summary.trim(),
        cover_url: coverUrl.trim(),
        icon_url: iconUrl.trim(),
        visibility,
        join_mode: joinMode,
        join_code: joinCode.trim() || undefined, // 留空＝沿用；有新的就立即雜湊
        signups_open: signupsOpen,
        world_blocks: worldBlocks
          .map((b) => ({ ...b, title: b.title.trim() }))
          .filter((b) => b.title || b.fields.some((f) => fieldHasContent(f.type, f.content, f.images))),
        qa: qa.map((x) => ({ ...x, q: x.q.trim(), a: x.a.trim() })).filter((x) => x.q && x.a),
        field_schema: fields.map((f) => ({ ...f, label: f.label.trim() })).filter((f) => f.label),
        tag_groups: tagGroups.map((g) => ({ ...g, name: g.name.trim(), tags: g.tags.map((t) => t.trim()).filter(Boolean) })).filter((g) => g.name && g.tags.length),
        links: sanitizeLinks(links),
        expected_rev: project?.rev,
      });
      if (!res.ok) {
        setError(res.error);
        return false;
      }
      clearBuffer(BUF_KEY(slug));
      snapshot.current = JSON.stringify({ ...currentForm(), joinCode: '' });
      setJoinCode('');
      toast('✓ 已儲存，所有人現在看到的就是這份內容');
      await refresh();
      return true;
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : '儲存失敗，請稍後再試');
      return false;
    } finally {
      setSaving(false);
    }
  };

  useLeaveGuard(dirty, doSave);

  const doRemove = async (charId: string, name: string) => {
    if (!window.confirm(`確定移除「${name}」？此為軟刪除，紀錄保留但角色不再公開。`)) return;
    try {
      const res = await removeCharacter(slug, charId);
      if (!res.ok) {
        toast(res.error, 'err');
        return;
      }
      toast(`已移除「${name}」（軟刪除，紀錄保留）`);
      await refresh();
    } catch (ex) {
      toast(ex instanceof Error ? ex.message : '移除失敗', 'err');
    }
  };

  if (project === undefined) {
    return (
      <ProjectShell slug={slug} title="" active="settings">
        <PageLoading text="正在打開開設者後台…" />
      </ProjectShell>
    );
  }
  if (project === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="font-huninn text-4xl">查無此企劃</div>
      </div>
    );
  }

  if (owner === false) {
    return (
      <ProjectShell slug={slug} title={project.title} active="settings">
        <div className="px-4 sm:px-6 py-16">
          <LoginPrompt title="開設者後台" hint="這是「開設者」專屬的頁面。用開這個企劃時的同一個 Discord 帳號登入即可進入。" />
        </div>
      </ProjectShell>
    );
  }
  if (owner === undefined) {
    return (
      <ProjectShell slug={slug} title={project.title} active="settings">
        <PageLoading text="正在打開開設者後台…" />
      </ProjectShell>
    );
  }

  return (
    <ProjectShell slug={slug} title={project.title} active="settings">
      <div className="kg-form-page mx-auto max-w-3xl px-4 sm:px-6 py-12 w-full">
        <a href={href(`/p/${slug}`)} className="font-mono2 text-xs text-[#6f6156] hover:text-[#9e4b2c]">
          ← 回企劃頁
        </a>
        <div className="mt-4 mb-3 kg-rise">
          <SecLabel>開設者後台</SecLabel>
          <h1 className="font-huninn text-4xl mt-2">{project.title}</h1>
        </div>
        <p className="text-sm text-[#6f6156] mb-8 leading-relaxed kg-rise">
          變更只存在這個瀏覽器，底欄按「儲存」才對所有人生效；離開頁面前會問你要不要儲存。
        </p>

        {restorable && (
          <div className="kg-card-flat p-4 mb-6 flex flex-wrap items-center gap-3" style={{ background: '#7fc0dc22' }}>
            <span className="text-sm font-bold">上次有未儲存的變更，要復原嗎？</span>
            <button
              type="button"
              className="kg-pill kg-pill-sm"
              onClick={() => {
                const r = restorable;
                setTitle(r.title); setSummary(r.summary); setCoverUrl(r.coverUrl); setIconUrl(r.iconUrl);
                setVisibility(r.visibility); setJoinMode(r.joinMode); setJoinCode(r.joinCode);
                setSignupsOpen(r.signupsOpen); setWorldBlocks(r.worldBlocks); setQa(r.qa); setFields(r.fields); setTagGroups(r.tagGroups ?? []); setLinks(r.links ?? []);
                setRestorable(null);
              }}
            >
              復原
            </button>
            <button
              type="button"
              className="kg-pill kg-pill-ghost kg-pill-sm"
              onClick={() => {
                clearBuffer(BUF_KEY(slug));
                setRestorable(null);
              }}
            >
              捨棄
            </button>
          </div>
        )}

        {error && (
          <div className="mb-6">
            <ErrorBox>{error}</ErrorBox>
          </div>
        )}

        <div className="kg-seg kg-seg-grow mb-8" role="tablist" aria-label="後台分頁">
          {(
            [
              ['info', '資訊'],
              ['world', '世界'],
              ['fields', '欄位'],
              ['tags', '詞庫'],
              ['roster', '名單'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} aria-pressed={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'info' && (
        <section className="kg-card p-6 sm:p-8 space-y-5 kg-rise">
          <SecLabel>企劃資訊</SecLabel>
          <div>
            <label htmlFor="fld-Manage-1" className="kg-label">
              企劃名稱 <span className="req">*</span>
            </label>
            <ImeInput id="fld-Manage-1" className="kg-input" value={title} onChange={setTitle} maxLength={40} />
          </div>
          <div>
            <label htmlFor="fld-Manage-2" className="kg-label">一句話簡介</label>
            <ImeInput id="fld-Manage-2" className="kg-input" value={summary} onChange={setSummary} maxLength={80} />
          </div>
          <div className="flex gap-3 items-start">
            <div className="flex-1 min-w-0">
              <ImageField label="封面圖" value={coverUrl} onChange={setCoverUrl} compact />
            </div>
            <div className="shrink-0">
              <ImageField label="企劃頭像" value={iconUrl} onChange={setIconUrl} square compact />
            </div>
          </div>
          <SocialLinksEditor value={links} onChange={setLinks} />
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
                <>
                  <input
                    className="kg-input font-mono2 mt-3"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    placeholder={project.has_join_code ? '留空 = 沿用原加入碼' : '設定加入碼'}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <p className="text-xs mt-1.5 font-bold" style={{ color: project.has_join_code ? '#24697f' : '#9e4b2c' }}>
                    {project.has_join_code ? '✓ 已設定加入碼' : '尚未設定加入碼——選了「需要加入碼」但沒設定的話，沒有人能加入'}
                  </p>
                </>
              )}
            </div>
          </div>
          <label className="flex items-center gap-2.5 text-sm font-bold cursor-pointer select-none">
            <input type="checkbox" checked={signupsOpen} onChange={(e) => setSignupsOpen(e.target.checked)} className="w-5 h-5 accent-[#9e4b2c]" />
            開放報名
          </label>
        </section>
        )}

        {tab === 'world' && (
        <>
        <section className="kg-rise">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <SecLabel>世界觀</SecLabel>
            <div className="kg-seg ml-auto" role="tablist" aria-label="世界觀編輯模式">
              <button type="button" role="tab" aria-selected={worldMode === 'fill'} aria-pressed={worldMode === 'fill'} onClick={() => setWorldMode('fill')}>
                填寫
              </button>
              <button type="button" role="tab" aria-selected={worldMode === 'schema'} aria-pressed={worldMode === 'schema'} onClick={() => setWorldMode('schema')}>
                組版
              </button>
            </div>
          </div>
          <p className="text-sm text-[#6f6156] mb-4 leading-relaxed">
            {worldMode === 'fill'
              ? '點一章打開來填。要加章節或改欄位型別，點「組版」。'
              : '用年表／地理／勢力／規則／用語／素材模板加一章。加完會回到填寫。'}
          </p>
          <BlocksEditor
            value={worldBlocks}
            onChange={setWorldBlocks}
            roster={rows.map((r) => ({ id: r.character.id, name: r.character.name, avatar_url: r.character.avatar_url }))}
            slug={slug}
            variant="world"
            mode={worldMode}
            seedOpenId={seedOpen}
            onRequestSchema={() => setWorldMode('schema')}
            onAdded={(id) => {
              setSeedOpen(id);
              setWorldMode('fill');
            }}
          />
        </section>

        <div className="kg-card-flat p-5 mt-8 kg-rise">
          <SecLabel>問答 QA</SecLabel>
          <p className="text-sm text-[#6f6156] mt-2 mb-4 leading-relaxed">常見問題集，企劃頁至少有一題才會顯示問答區。</p>
          <QaEditor value={qa} onChange={setQa} groups={tagGroups} />
        </div>
        </>
        )}

        {tab === 'fields' && (
        <section className="kg-rise">
          <SecLabel>角色欄位</SecLabel>
          <p className="text-sm text-[#6f6156] mt-2 mb-4 leading-relaxed">
            創建角色時要填的欄位。設為必填的，參加者不填就無法建立。
          </p>
          <FieldsEditor value={fields} onChange={setFields} />
        </section>
        )}

        {tab === 'tags' && (
        <section className="kg-rise">
          <SecLabel>分類詞庫</SecLabel>
          <p className="text-sm text-[#6f6156] mt-2 mb-4 leading-relaxed">
            陣營、種族這類標籤。角色加入／編輯時勾選，問答也可掛同一批。企劃頁的名單與問答能用標籤篩選。
          </p>
          <TagGroupEditor value={tagGroups} onChange={setTagGroups} />
        </section>
        )}

        {tab === 'roster' && (
        <section className="kg-rise">
          <SecLabel>名單總覽</SecLabel>
          <h2 className="font-huninn text-2xl mt-1.5 mb-4">{rows.length} 位角色</h2>
          <div className="kg-card-flat overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-[#e8dfd4] text-left">
                  <th className="px-4 py-3 font-bold">角色</th>
                  <th className="px-4 py-3 font-bold whitespace-nowrap">未填設定</th>
                  <th className="px-4 py-3 font-bold whitespace-nowrap">已牽成</th>
                  <th className="px-4 py-3 font-bold whitespace-nowrap">加入時間</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ character: c, unfilled, relationCount }) => (
                  <tr key={c.id} className="border-b border-dashed border-[#e8dfd4]/20 last:border-0 hover:bg-[#7fc0dc22]">
                    <td className="px-4 py-2.5">
                      <a href={href(`/p/${slug}/c/${c.id}`)} className="flex items-center gap-2 font-bold hover:text-[#9e4b2c]">
                        <CharAvatar name={c.name} url={c.avatar_url} size={30} />
                        {c.name}
                        {c.status === 'draft' && (
                          <span className="kg-tag" style={{ background: '#fcebf0', color: '#a8455e' }}>
                            草稿
                          </span>
                        )}
                      </a>
                    </td>
                    <td className="px-4 py-2.5">
                      {unfilled > 0 ? (
                        <span className="kg-tag" style={{ background: '#fcebf0' }}>
                          {unfilled} 項
                        </span>
                      ) : (
                        <span className="text-[#6f6156]">填完</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {relationCount === 0 ? (
                        <span className="kg-tag" style={{ background: '#fcebf0' }}>
                          零關係
                        </span>
                      ) : (
                        <span className="font-mono2">{relationCount}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono2 text-xs text-[#6f6156] whitespace-nowrap">{timeAgo(c.created_at)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm" onClick={() => doRemove(c.id, c.name)}>
                        移除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="font-mono2 text-[11px] text-[#6f6156] mt-3">＊ 移除為軟刪除：角色不再公開顯示，紀錄保留以備追溯。</p>
        </section>
        )}
      </div>
      <StickySaveBar inShell dirty={dirty} busy={saving} onSave={() => { void doSave(); }} />
    </ProjectShell>
  );
}
