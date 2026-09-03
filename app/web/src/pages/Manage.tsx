import { useEffect, useRef, useState } from 'react';
import { getProject, removeCharacter, rosterStats, updateProject, verifyOwner, type RosterRow } from '../lib/api';
import { href, timeAgo } from '../lib/nav';
import { clearBuffer, loadBuffer, saveBuffer, useLeaveGuard } from '../lib/dirty';
import {
  BlocksEditor,
  CharAvatar,
  ErrorBox,
  FieldsEditor,
  ImageField,
  PageLoading,
  QaEditor,
  SecLabel,
  SiteFooter,
  SiteHeader,
  TokenGate,
  toast,
} from '../components/kg';
import { fieldHasContent } from '../lib/fvals';
import type { FieldDef, Project, QaItem, WorldBlock } from '../lib/types';

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
}

export default function ManagePage({ slug }: { slug: string }) {
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [authed, setAuthed] = useState(false);
  const [gateToken, setGateToken] = useState('');
  const [gateError, setGateError] = useState<string | null>(null);
  const [gateBusy, setGateBusy] = useState(false);
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

  const [rows, setRows] = useState<RosterRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [restorable, setRestorable] = useState<FormState | null>(null); // 本機緩衝比伺服器新 → 問要不要復原
  const snapshot = useRef(''); // 上次載入/儲存時的狀態指纹

  const currentForm = (): FormState => ({
    title, summary, coverUrl, iconUrl, visibility, joinMode, joinCode, signupsOpen, worldBlocks, qa, fields,
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
  };

  const dirty = authed && snapshot.current !== '' && snapshot.current !== JSON.stringify({ ...currentForm(), joinCode: '' });

  const refresh = async () => {
    const p = await getProject(slug);
    setProject(p ?? null);
    if (p) setRows(await rosterStats(slug));
  };

  useEffect(() => {
    (async () => {
      const p = await getProject(slug);
      setProject(p ?? null);
      if (!p) return;
      const ok = await verifyOwner(slug); // cookie 優先
      if (ok) {
        setAuthed(true);
        applyProject(ok);
        snapshot.current = JSON.stringify({ ...({
          title: ok.title, summary: ok.summary, coverUrl: ok.cover_url ?? '', iconUrl: ok.icon_url ?? '',
          visibility: ok.visibility, joinMode: ok.join_mode, joinCode: '', signupsOpen: ok.signups_open,
          worldBlocks: ok.world_blocks, qa: ok.qa, fields: ok.field_schema,
        }) });
        setRows(await rosterStats(slug));
        // 本機復原緩衝：比伺服器新就問（§12-6）
        const buf = loadBuffer<FormState>(BUF_KEY(slug));
        if (buf && buf.savedAt > ok.updated_at) setRestorable(buf.data);
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
  }, [dirty, title, summary, coverUrl, iconUrl, visibility, joinMode, joinCode, signupsOpen, worldBlocks, qa, fields]);

  const doSave = async (): Promise<boolean> => {
    if (saving) return false;
    if (!title.trim()) {
      setError('企劃名稱不能空白');
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
      const res = await removeCharacter(slug, '', charId);
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
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="flex-1">
          <PageLoading text="正在打開開設者後台…" />
        </main>
      </div>
    );
  }
  if (project === null) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="flex-1 flex items-center justify-center">
          <div className="font-huninn text-4xl">查無此企劃</div>
        </main>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="flex-1 px-4 sm:px-6 py-16">
          <TokenGate
            title="開設者後台"
            hint="需要開設者碼（own_…）。若換了瀏覽器，貼上建立企劃時保存的權杖即可進入。"
            token={gateToken}
            setToken={setGateToken}
            busy={gateBusy}
            error={gateError}
            onSubmit={async () => {
              setGateBusy(true);
              setGateError(null);
              const ok = await verifyOwner(slug, gateToken); // 驗過後端會種 cookie
              setGateBusy(false);
              if (!ok) return setGateError('企劃不存在或權杖錯誤');
              setAuthed(true);
              applyProject(ok);
              snapshot.current = JSON.stringify({ ...currentForm(), joinCode: '' });
              setRows(await rosterStats(slug));
            }}
          />
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-12 w-full">
        <a href={href(`/p/${slug}`)} className="font-mono2 text-xs text-[#6f6156] hover:text-[#9e4b2c]">
          ← 回企劃頁
        </a>
        <div className="mt-4 mb-3 kg-rise flex flex-wrap items-end gap-3">
          <div>
            <SecLabel>開設者後台</SecLabel>
            <h1 className="font-huninn text-4xl mt-2">{project.title}</h1>
          </div>
          <div className="ml-auto flex items-center gap-2.5 pb-1">
            {dirty && (
              <span className="kg-tag" style={{ background: '#f6efe4', color: '#9e4b2c' }}>
                ● 有未儲存的變更
              </span>
            )}
            <button type="button" className="kg-pill kg-pill-red" disabled={!dirty || saving} onClick={doSave}>
              {saving ? '儲存中…' : '儲存'}
            </button>
          </div>
        </div>
        <p className="text-sm text-[#6f6156] mb-8 leading-relaxed kg-rise">
          變更只存在這個瀏覽器，按「儲存」才對所有人生效；離開頁面前會問你要不要儲存。
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
                setSignupsOpen(r.signupsOpen); setWorldBlocks(r.worldBlocks); setQa(r.qa); setFields(r.fields);
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

        {/* 企劃資訊 */}
        <section className="kg-card p-6 sm:p-8 space-y-5 kg-rise">
          <SecLabel>企劃資訊</SecLabel>
          <div>
            <label htmlFor="fld-Manage-1" className="kg-label">
              企劃名稱 <span className="req">*</span>
            </label>
            <input id="fld-Manage-1" className="kg-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} />
          </div>
          <div>
            <label htmlFor="fld-Manage-2" className="kg-label">一句話簡介</label>
            <input id="fld-Manage-2" className="kg-input" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={80} />
          </div>
          <ImageField label="封面圖" value={coverUrl} onChange={setCoverUrl} hint="企劃頁頂部大圖，建議橫幅。" />
          <ImageField label="企劃頭像" value={iconUrl} onChange={setIconUrl} hint="列表與頁首用的小方圖。" square />
          <div className="grid sm:grid-cols-2 gap-5">
            <div>
              <label className="kg-label">能見度</label>
              <div className="space-y-2">
                {(
                  [
                    ['unlisted', '未列出（不被索引）'],
                    ['public', '公開（首頁列表）'],
                  ] as const
                ).map(([v, label]) => (
                  <label key={v} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" checked={visibility === v} onChange={() => setVisibility(v)} className="accent-[#9e4b2c]" />
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
                    ['code', '需要加入碼'],
                  ] as const
                ).map(([v, label]) => (
                  <label key={v} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" checked={joinMode === v} onChange={() => setJoinMode(v)} className="accent-[#9e4b2c]" />
                    {label}
                  </label>
                ))}
              </div>
              {joinMode === 'code' && (
                <input
                  className="kg-input font-mono2 mt-3"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder={project.join_code_hash ? '留空 = 沿用原加入碼' : '設定加入碼'}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              )}
            </div>
          </div>
          <label className="flex items-center gap-2.5 text-sm font-bold cursor-pointer select-none">
            <input type="checkbox" checked={signupsOpen} onChange={(e) => setSignupsOpen(e.target.checked)} className="w-5 h-5 accent-[#9e4b2c]" />
            開放報名
          </label>
        </section>

        {/* 世界觀區塊 */}
        <details className="kg-card kg-collapse p-6 sm:p-8 mt-10 kg-rise" style={{ animationDelay: '0.04s' }} open>
          <summary className="cursor-pointer">
            <div className="flex items-center gap-3">
              <SecLabel>世界觀</SecLabel>
              <span className="kg-chevron ml-auto text-[#6f6156]" aria-hidden="true">▾</span>
            </div>
            <p className="text-sm text-[#6f6156] mt-2 leading-relaxed">
              一個區塊裡可以放多個欄位，各自選型別：文字、標籤、核取清單、五維雷達、時間線、行事曆、色票、圖片相簿、PDF、音樂、影片、關聯角色等。新增區塊可從模板開始。
            </p>
          </summary>
          <div className="mt-5">
            <BlocksEditor
              value={worldBlocks}
              onChange={setWorldBlocks}
              roster={rows.map((r) => ({ id: r.character.id, name: r.character.name, avatar_url: r.character.avatar_url }))}
              slug={slug}
            />
          </div>
        </details>

        {/* QA */}
        <details className="kg-card kg-collapse p-6 sm:p-8 mt-10 kg-rise" style={{ animationDelay: '0.08s' }} open>
          <summary className="cursor-pointer">
            <div className="flex items-center gap-3">
              <SecLabel>問答 QA</SecLabel>
              <span className="kg-chevron ml-auto text-[#6f6156]" aria-hidden="true">▾</span>
            </div>
            <p className="text-sm text-[#6f6156] mt-2 leading-relaxed">常見問題集，企劃頁的「問答」區會在至少有一題時出現。</p>
          </summary>
          <div className="mt-5">
            <QaEditor value={qa} onChange={setQa} />
          </div>
        </details>

        {/* 角色必填欄位 */}
        <details className="kg-card kg-collapse p-6 sm:p-8 mt-10 kg-rise" style={{ animationDelay: '0.12s' }} open>
          <summary className="cursor-pointer">
            <div className="flex items-center gap-3">
              <SecLabel>角色欄位</SecLabel>
              <span className="kg-chevron ml-auto text-[#6f6156]" aria-hidden="true">▾</span>
            </div>
            <p className="text-sm text-[#6f6156] mt-2 leading-relaxed">
              自訂創建角色時要填的欄位；勾「必填」的欄位，參加者不填就無法建立角色卡。
            </p>
          </summary>
          <div className="mt-5">
            <FieldsEditor value={fields} onChange={setFields} />
          </div>
        </details>

        {/* 名單總覽 */}
        <section className="mt-12 kg-rise" style={{ animationDelay: '0.16s' }}>
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
      </main>
      <SiteFooter />
    </div>
  );
}
