import { useEffect, useMemo, useState } from 'react';
import {
  addRelationNote,
  createPrivateRelation,
  deletePrivateRelation,
  deleteRelationNote,
  getCharacter,
  initiateRelation,
  listCharacters,
  listPrivateRelations,
  promotePrivateRelation,
  relationsForChar,
  respondRelation,
  sideOf,
  unwireRelation,
  updatePrivateRelation,
  updateRelationSide,
} from '../lib/api';
import { href } from '../lib/nav';
import { PageLoading,
  CharAvatar,
  EmptyNote,
  ErrorBox,
  LoginPrompt,
  RelationNotes,
  SecLabel,
  ThreadLink,
  toast,
} from '../components/kg';
import { ProjectShell } from '../components/project-shell';
import type { Character, PrivateRelation, Project, Relation } from '../lib/types';

export default function RelationsPage({ slug, charId }: { slug: string; charId: string }) {
  const [data, setData] = useState<{ project: Project; character: Character } | null | undefined>(undefined);
  const [owner, setOwner] = useState<boolean | undefined>(undefined);

  const [rels, setRels] = useState<Relation[]>([]);
  const [charMap, setCharMap] = useState<Map<string, Character>>(new Map());
  const [allChars, setAllChars] = useState<Character[]>([]);

  // 發起表單：搜尋對方
  const [query, setQuery] = useState('');
  const [targetId, setTargetId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newNote, setNewNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 私人紀錄（對方還沒加入，或還沒對上真人，1.5-2）
  const [privRels, setPrivRels] = useState<PrivateRelation[]>([]);
  const [ghostName, setGhostName] = useState('');
  const [ghostLabel, setGhostLabel] = useState('');
  const [ghostNote, setGhostNote] = useState('');
  const [ghostBusy, setGhostBusy] = useState(false);

  // 私人紀錄的編輯（逐條，Ticket-14：既有紀錄的 label/note 也要能改）
  const [ghostEditOpen, setGhostEditOpen] = useState<Record<number, boolean>>({});
  const [ghostEditLabel, setGhostEditLabel] = useState<Record<number, string>>({});
  const [ghostEditNote, setGhostEditNote] = useState<Record<number, string>>({});
  const [ghostEditBusy, setGhostEditBusy] = useState<Record<number, boolean>>({});

  // 回應表單（逐條）
  const [respLabel, setRespLabel] = useState<Record<number, string>>({});
  const [respNote, setRespNote] = useState<Record<number, string>>({});
  const [respError, setRespError] = useState<Record<number, string>>({});

  // 修改已牽成（逐條）
  const [editOpen, setEditOpen] = useState<Record<number, boolean>>({});
  const [editLabel, setEditLabel] = useState<Record<number, string>>({});
  const [editNote, setEditNote] = useState<Record<number, string>>({});
  const [extrasOpen, setExtrasOpen] = useState<Record<number, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = async () => {
    // 1-2：四條查詢彼此不依賴，並行抓
    const [got, relList, chars, priv] = await Promise.all([
      getCharacter(slug, charId),
      relationsForChar(slug, charId),
      listCharacters(slug),
      listPrivateRelations(slug, charId),
    ]);
    setData(got);
    if (!got) return;
    setRels(relList);
    setAllChars(chars);
    setCharMap(new Map(chars.map((c) => [c.id, c])));
    setPrivRels(priv);
  };

  useEffect(() => {
    (async () => {
      const got = await getCharacter(slug, charId);
      setData(got);
      if (!got) return;
      setOwner(got.viewer.owned);
    })();
  }, [slug, charId]);

  useEffect(() => {
    if (owner) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  const grouped = useMemo(() => {
    const incoming: Relation[] = [];
    const outgoing: Relation[] = [];
    const accepted: Relation[] = [];
    const declined: Relation[] = [];
    for (const r of rels) {
      const side = sideOf(r, charId)!;
      if (r.status === 'pending') {
        (r.initiator === side ? outgoing : incoming).push(r);
      } else if (r.status === 'accepted') {
        accepted.push(r);
      } else {
        declined.push(r);
      }
    }
    return { incoming, outgoing, accepted, declined };
  }, [rels, charId]);

  // 可發起對象：搜尋名字（排除自己；已有牽線的標註）
  const takenTargets = useMemo(
    () => new Set(rels.filter((r) => r.status !== 'declined').map((r) => (sideOf(r, charId) === 'a' ? r.b_id : r.a_id))),
    [rels, charId],
  );
  const declinedTargets = useMemo(
    () => new Set(rels.filter((r) => r.status === 'declined').map((r) => (sideOf(r, charId) === 'a' ? r.b_id : r.a_id))),
    [rels, charId],
  );
  const matches = useMemo(() => {
    const kw = query.trim().toLowerCase();
    return allChars
      .filter((c) => c.id !== charId)
      .filter((c) => !kw || c.name.toLowerCase().includes(kw))
      .slice(0, 8);
  }, [allChars, charId, query]);

  if (data === undefined) return (
    <ProjectShell slug={slug} title="" active={null}>
      <PageLoading />
    </ProjectShell>
  );
  if (data === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="font-huninn text-4xl">查無此角色</div>
      </div>
    );
  }

  if (owner === false) {
    return (
      <ProjectShell slug={slug} title={data.project.title} iconUrl={data.project.icon_url} active={null}>
        <div className="px-4 sm:px-6 py-16">
          <LoginPrompt title={`「${data.character.name}」的牽線管理`} hint="這是這隻角色本人專屬的頁面。用建立這隻角色時的同一個 Discord 帳號登入即可管理牽線。" />
        </div>
      </ProjectShell>
    );
  }

  const me = data.character;

  const otherOf = (r: Relation): Character | undefined => {
    const side = sideOf(r, charId)!;
    return charMap.get(side === 'a' ? r.b_id : r.a_id);
  };
  const myLabelOf = (r: Relation) => (sideOf(r, charId) === 'a' ? r.a_label : r.b_label);
  const myNoteOf = (r: Relation) => (sideOf(r, charId) === 'a' ? r.a_note : r.b_note);
  const theirLabelOf = (r: Relation) => (sideOf(r, charId) === 'a' ? r.b_label : r.a_label);
  const theirNoteOf = (r: Relation) => (sideOf(r, charId) === 'a' ? r.b_note : r.a_note);

  const doInitiate = async () => {
    setFormError(null);
    if (!targetId) return setFormError('請選擇對方角色（沒有的話先建草稿）');
    if (!newLabel.trim()) return setFormError('請填「你眼中的 TA」');
    setBusy(true);
    try {
      const res = await initiateRelation(slug, charId, targetId, newLabel, newNote);
      if (!res.ok) return setFormError(res.error);
      setTargetId('');
      setQuery('');
      setNewLabel('');
      setNewNote('');
      setNotice('已發出牽線，等對方補完後公開。');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const doAddGhost = async () => {
    setFormError(null);
    if (!ghostName.trim()) return setFormError('請填對方的名字');
    setGhostBusy(true);
    try {
      const res = await createPrivateRelation(slug, charId, ghostName, ghostLabel, ghostNote);
      if (!res.ok) return setFormError(res.error);
      setGhostName('');
      setGhostLabel('');
      setGhostNote('');
      await refresh();
    } finally {
      setGhostBusy(false);
    }
  };

  const doDeleteGhost = async (id: number) => {
    const res = await deletePrivateRelation(slug, charId, id);
    if (!res.ok) return toast(res.error, 'err');
    await refresh();
  };

  const openGhostEdit = (p: PrivateRelation) => {
    setGhostEditOpen((o) => ({ ...o, [p.id]: !o[p.id] }));
    setGhostEditLabel((l) => ({ ...l, [p.id]: p.label }));
    setGhostEditNote((n) => ({ ...n, [p.id]: p.note }));
  };

  const doEditGhost = async (id: number) => {
    setGhostEditBusy((b) => ({ ...b, [id]: true }));
    try {
      const res = await updatePrivateRelation(slug, charId, id, ghostEditLabel[id] ?? '', ghostEditNote[id] ?? '');
      if (!res.ok) return toast(res.error, 'err');
      setGhostEditOpen((o) => ({ ...o, [id]: false }));
      await refresh();
    } finally {
      setGhostEditBusy((b) => ({ ...b, [id]: false }));
    }
  };

  const doPromoteGhost = async (id: number) => {
    const res = await promotePrivateRelation(slug, charId, id);
    if (!res.ok) return toast(res.error, 'err');
    setNotice('已送出正式邀請，等對方回應。');
    await refresh();
  };

  const doRespond = async (r: Relation, action: 'accept' | 'decline') => {
    const id = r.id;
    setRespError((e) => ({ ...e, [id]: '' }));
    if (action === 'accept' && !(respLabel[id] ?? '').trim()) {
      setRespError((e) => ({ ...e, [id]: '請填「你眼中的 TA」再確認牽成' }));
      return;
    }
    const res = await respondRelation(slug, charId, id, action, respLabel[id] ?? '', respNote[id] ?? '');
    if (!res.ok) return setRespError((e) => ({ ...e, [id]: res.error }));
    setNotice(action === 'accept' ? '牽線成功！已公開並寫入動態牆。' : '已婉拒，這條紀錄僅雙方可見。');
    await refresh();
  };

  const doUpdateSide = async (r: Relation) => {
    const id = r.id;
    const res = await updateRelationSide(slug, charId, id, editLabel[id] ?? '', editNote[id] ?? '');
    if (!res.ok) return toast(res.error, 'err');
    setEditOpen((o) => ({ ...o, [id]: false }));
    toast('已更新你眼中的 TA');
    await refresh();
  };

  const doAddNote = async (r: Relation, body: string) => {
    const res = await addRelationNote(slug, charId, r.id, body);
    if (!res.ok) return toast(res.error, 'err');
    await refresh();
  };

  const doDeleteNote = async (r: Relation, noteId: number) => {
    const res = await deleteRelationNote(slug, charId, r.id, noteId);
    if (!res.ok) return toast(res.error, 'err');
    await refresh();
  };

  const doUnwire = async (r: Relation) => {
    if (!window.confirm('確定解除這條關係？紀錄會保留但不再公開。')) return;
    const res = await unwireRelation(slug, charId, r.id);
    if (!res.ok) return toast(res.error, 'err');
    setNotice('已解除，紀錄保留（僅雙方可見）。');
    await refresh();
  };

  const target = targetId ? charMap.get(targetId) : undefined;

  return (
    <ProjectShell slug={slug} title={data.project.title} iconUrl={data.project.icon_url} active={null}>
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 w-full">
        <a href={href(`/p/${slug}/c/${charId}`)} className="font-mono2 text-xs text-[#6f6156] hover:text-[#9e4b2c]">
          ← 回角色頁
        </a>
        <div className="flex items-center gap-4 mt-4 mb-8 kg-rise">
          <CharAvatar name={me.name} url={me.avatar_url} size={54} />
          <div>
            <SecLabel>牽線管理</SecLabel>
            <h1 className="font-huninn text-3xl mt-1">{me.name} 的紅線</h1>
          </div>
        </div>

        {notice && (
          <div className="rounded-xl border-2 border-[#e8dfd4] bg-[#e9f3f9]/30 px-4 py-3 text-sm font-bold mb-6 flex items-center justify-between">
            {notice}
            <button type="button" className="font-mono2 text-xs underline" onClick={() => setNotice(null)}>
              關閉
            </button>
          </div>
        )}

        {/* 待你回應 */}
        <section className="mb-10 kg-rise">
          <SecLabel>待你回應</SecLabel>
          {grouped.incoming.length === 0 ? (
            <div className="mt-3">
              <EmptyNote>目前沒有送上門的紅線。</EmptyNote>
            </div>
          ) : (
            <div className="space-y-4 mt-3">
              {grouped.incoming.map((r) => {
                const other = otherOf(r);
                if (!other) return null;
                return (
                  <div key={r.id} className="kg-card p-5" style={{ background: '#7fc0dc22' }}>
                    <div className="flex items-center gap-3 flex-wrap mb-3">
                      <CharAvatar name={other.name} url={other.avatar_url} size={38} />
                      <b className="text-lg">{other.name}</b>
                      {other.status === 'draft' && (
                        <span className="kg-tag" style={{ background: '#fcebf0', color: '#a8455e' }}>
                          草稿
                        </span>
                      )}
                      <span className="kg-tag" style={{ background: '#7fc0dc' }}>
                        邀請你牽線
                      </span>
                    </div>
                    <div className="kg-seclabel mb-1">（{other.name} 眼中的 {me.name}）</div>
                    <p className="text-sm mb-1">
                      <b>{theirLabelOf(r)}</b>
                    </p>
                    {theirNoteOf(r) && <p className="text-sm text-[#6f6156] leading-relaxed mb-4">{theirNoteOf(r)}</p>}
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="fld-Relations-1" className="kg-label">你眼中的 {other.name}（稱呼）*</label>
                        <input
id="fld-Relations-1"                           className="kg-input"
                          value={respLabel[r.id] ?? ''}
                          onChange={(e) => setRespLabel({ ...respLabel, [r.id]: e.target.value })}
                          placeholder="例：霧中剪"
                          maxLength={20}
                        />
                      </div>
                      <div>
                        <label htmlFor="fld-Relations-2" className="kg-label">關係註記</label>
                        <input
id="fld-Relations-2"                           className="kg-input"
                          value={respNote[r.id] ?? ''}
                          onChange={(e) => setRespNote({ ...respNote, [r.id]: e.target.value })}
                          placeholder="公開顯示在你的角色頁"
                          maxLength={200}
                        />
                      </div>
                    </div>
                    {respError[r.id] && (
                      <div className="mt-3">
                        <ErrorBox>{respError[r.id]}</ErrorBox>
                      </div>
                    )}
                    <div className="flex gap-2.5 mt-4">
                      <button type="button" className="kg-pill kg-pill-red kg-pill-sm" onClick={() => doRespond(r, 'accept')}>
                        ✓ 補完並牽成
                      </button>
                      <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm" onClick={() => doRespond(r, 'decline')}>
                        婉拒
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 等待對方 */}
        {grouped.outgoing.length > 0 && (
          <section className="mb-10">
            <SecLabel>等待對方回應</SecLabel>
            <div className="space-y-3 mt-3">
              {grouped.outgoing.map((r) => {
                const other = otherOf(r);
                if (!other) return null;
                return (
                  <div key={r.id} className="kg-card-flat p-4 flex items-center gap-3 flex-wrap">
                    <CharAvatar name={other.name} url={other.avatar_url} size={34} />
                    <div className="flex-1 min-w-0">
                      <b>{other.name}</b>
                      {other.status === 'draft' && (
                        <span className="kg-tag ml-2" style={{ background: '#fcebf0', color: '#a8455e' }}>
                          草稿
                        </span>
                      )}
                      <span className="text-sm text-[#6f6156] ml-2">你寫的：「{myLabelOf(r)}」{myNoteOf(r) ? ` — ${myNoteOf(r)}` : ''}</span>
                    </div>
                    <span className="kg-tag">等回應</span>
                    <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm" onClick={() => doUnwire(r)}>
                      收回
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 已牽成 */}
        <section className="mb-10">
          <SecLabel>已牽成</SecLabel>
          {grouped.accepted.length === 0 ? (
            <div className="mt-3">
              <EmptyNote>還沒有牽成的關係。</EmptyNote>
            </div>
          ) : (
            <div className="space-y-4 mt-3">
              {grouped.accepted.map((r) => {
                const other = otherOf(r);
                if (!other) return null;
                const editing = editOpen[r.id];
                const editingExtras = extrasOpen[r.id];
                return (
                  <div key={r.id} className="kg-card p-5">
                    <div className="flex items-center gap-3 flex-wrap">
                      <a href={href(`/p/${slug}/c/${other.id}`)} className="flex items-center gap-2 font-bold hover:text-[#9e4b2c]">
                        <CharAvatar name={other.name} url={other.avatar_url} size={36} />
                        {other.name}
                      </a>
                      <ThreadLink className="w-10" />
                      <span className="kg-tag" style={{ background: '#f5aebd', color: '#6b2438' }}>
                        已牽成
                      </span>
                      <div className="ml-auto flex gap-2 flex-wrap">
                        <button
                          type="button"
                          className="kg-pill kg-pill-sm"
                          onClick={() => {
                            setEditOpen((o) => ({ ...o, [r.id]: !editing }));
                            setEditLabel((m) => ({ ...m, [r.id]: myLabelOf(r) }));
                            setEditNote((m) => ({ ...m, [r.id]: myNoteOf(r) }));
                          }}
                        >
                          {editing ? '收起' : '改我這側'}
                        </button>
                        <button
                          type="button"
                          className="kg-pill kg-pill-sm kg-pill-ghost"
                          onClick={() => setExtrasOpen((o) => ({ ...o, [r.id]: !editingExtras }))}
                        >
                          {editingExtras ? '收起共用筆記' : '共用筆記'}
                        </button>
                        <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm" onClick={() => doUnwire(r)}>
                          解除
                        </button>
                      </div>
                    </div>
                    {editing ? (
                      <div className="mt-4 space-y-3">
                        <div>
                          <label htmlFor="fld-Relations-3" className="kg-label">你眼中的 {other.name}（稱呼）</label>
                          <input id="fld-Relations-3" className="kg-input" value={editLabel[r.id] ?? ''} onChange={(e) => setEditLabel({ ...editLabel, [r.id]: e.target.value })} maxLength={20} />
                        </div>
                        <div>
                          <label htmlFor="fld-Relations-4" className="kg-label">關係註記</label>
                          <textarea id="fld-Relations-4" className="kg-textarea" value={editNote[r.id] ?? ''} onChange={(e) => setEditNote({ ...editNote, [r.id]: e.target.value })} maxLength={200} />
                        </div>
                        <button type="button" className="kg-pill kg-pill-red kg-pill-sm" onClick={() => doUpdateSide(r)}>
                          儲存（不需對方重新確認）
                        </button>
                      </div>
                    ) : (
                      <div className="grid sm:grid-cols-2 gap-4 mt-4">
                        <div>
                          <div className="kg-seclabel mb-1">（你這側）</div>
                          <p className="text-sm">
                            <b>{myLabelOf(r) || '—'}</b>
                          </p>
                          <p className="text-sm text-[#6f6156] leading-relaxed">{myNoteOf(r) || '—'}</p>
                        </div>
                        <div>
                          <div className="kg-seclabel mb-1">（對方那側）</div>
                          <p className="text-sm">
                            <b>{theirLabelOf(r) || '—'}</b>
                          </p>
                          <p className="text-sm text-[#6f6156] leading-relaxed">{theirNoteOf(r) || '—'}</p>
                        </div>
                      </div>
                    )}
                    {editingExtras && (
                      <div className="mt-4 pt-4 border-t border-dashed border-[#e8dfd4] space-y-3">
                        <div className="kg-seclabel">（共用筆記）</div>
                        <RelationNotes
                          notes={r.notes}
                          mySide={sideOf(r, charId)!}
                          onAdd={(body) => doAddNote(r, body)}
                          onDelete={(noteId) => doDeleteNote(r, noteId)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 發起新牽線 */}
        <section className="mb-6">
          <SecLabel>發起新牽線</SecLabel>
          <div className="kg-card p-5 sm:p-6 mt-3 space-y-4">
            <div>
              <label htmlFor="fld-Relations-5" className="kg-label">對方角色（可搜尋名字）</label>
              <input
id="fld-Relations-5"                 className="kg-input"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setTargetId('');
                }}
                placeholder="輸入對方角色名字…"
                maxLength={30}
              />
              {query.trim() && !targetId && (
                <div className="kg-card-flat mt-2 divide-y divide-dashed divide-[#e8dfd4] max-h-56 overflow-auto">
                  {matches.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-[#6f6156]">企劃裡沒有這個名字——可以在下方先幫 TA 建草稿。</div>
                  ) : (
                    matches.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        disabled={takenTargets.has(c.id)}
                        className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-[#7fc0dc22] disabled:opacity-50"
                        onClick={() => {
                          setTargetId(c.id);
                          setQuery(c.name);
                        }}
                      >
                        <CharAvatar name={c.name} url={c.avatar_url} size={28} />
                        <b className="text-sm">{c.name}</b>
                        <span className="font-mono2 text-[11px] text-[#6f6156]">{c.id}</span>
                        {c.status === 'draft' && (
                          <span className="kg-tag" style={{ background: '#fcebf0', color: '#a8455e' }}>
                            草稿
                          </span>
                        )}
                        {takenTargets.has(c.id) && <span className="kg-tag ml-auto">已有牽線</span>}
                        {!takenTargets.has(c.id) && declinedTargets.has(c.id) && (
                          <span className="font-mono2 text-[11px] text-[#a8455e] ml-auto">曾被婉拒，可重新邀請</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
              {target && (
                <div className="kg-card-flat mt-2 px-4 py-2.5 flex items-center gap-3" style={{ background: '#e9f3f9' }}>
                  <CharAvatar name={target.name} url={target.avatar_url} size={28} />
                  <b className="text-sm">{target.name}</b>
                  {target.status === 'draft' && (
                    <span className="kg-tag" style={{ background: '#fcebf0', color: '#a8455e' }}>
                      草稿・待認領
                    </span>
                  )}
                  <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm ml-auto" onClick={() => { setTargetId(''); setQuery(''); }}>
                    重選
                  </button>
                </div>
              )}
            </div>

            {/* 對方還沒加入企劃：記一筆只有自己看得到的私人紀錄，不建角色 */}
            <div className="kg-card-flat p-4" style={{ background: '#fbf8f3' }}>
              <div className="kg-seclabel mb-2">（對方還沒加入企劃？）</div>
              <p className="text-xs text-[#6f6156] leading-relaxed mb-3">
                先記下對方的名字，只有你看得到。之後對方真的加入且建了同名角色，這裡會出現「送出正式邀請」的建議。
              </p>
              <div className="flex gap-2 flex-wrap">
                <input
                  className="kg-input !w-auto flex-1 min-w-[160px]"
                  value={ghostName}
                  onChange={(e) => setGhostName(e.target.value)}
                  placeholder="對方的名字"
                  maxLength={40}
                />
                <button type="button" className="kg-pill kg-pill-ink kg-pill-sm" disabled={ghostBusy || !ghostName.trim()} onClick={doAddGhost}>
                  {ghostBusy ? '記錄中…' : '記下對方名字'}
                </button>
              </div>
              <div className="grid sm:grid-cols-2 gap-2 mt-2">
                <input
                  className="kg-input"
                  value={ghostLabel}
                  onChange={(e) => setGhostLabel(e.target.value)}
                  placeholder="你們的關係（例：師徒）"
                  maxLength={40}
                />
                <input
                  className="kg-input"
                  value={ghostNote}
                  onChange={(e) => setGhostNote(e.target.value)}
                  placeholder="互動筆記，只有你看得到"
                  maxLength={2000}
                />
              </div>
              {privRels.length > 0 && (
                <div className="mt-3 space-y-2">
                  {privRels.map((p) => (
                    <div key={p.id} className="kg-card-flat p-3 bg-white">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <b className="text-sm">{p.ghost_name}</b>
                          {p.label && <span className="text-xs text-[#6f6156] ml-2">（{p.label}）</span>}
                          {p.suggested_char_id && (
                            <span className="text-xs text-[#6f6156] ml-2">
                              站上有同名角色，要送出正式邀請嗎？
                            </span>
                          )}
                          {p.note && !ghostEditOpen[p.id] && (
                            <p className="text-xs text-[#6f6156] mt-1 leading-relaxed">{p.note}</p>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          {p.suggested_char_id && (
                            <button type="button" className="kg-pill kg-pill-red kg-pill-sm" onClick={() => doPromoteGhost(p.id)}>
                              送出邀請
                            </button>
                          )}
                          <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm" onClick={() => openGhostEdit(p)}>
                            {ghostEditOpen[p.id] ? '取消' : '編輯'}
                          </button>
                          <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm" onClick={() => doDeleteGhost(p.id)}>
                            刪除
                          </button>
                        </div>
                      </div>
                      {ghostEditOpen[p.id] && (
                        <div className="grid sm:grid-cols-2 gap-2 mt-3">
                          <input
                            className="kg-input"
                            value={ghostEditLabel[p.id] ?? ''}
                            onChange={(e) => setGhostEditLabel((l) => ({ ...l, [p.id]: e.target.value }))}
                            placeholder="你們的關係"
                            maxLength={40}
                          />
                          <input
                            className="kg-input"
                            value={ghostEditNote[p.id] ?? ''}
                            onChange={(e) => setGhostEditNote((n) => ({ ...n, [p.id]: e.target.value }))}
                            placeholder="互動筆記"
                            maxLength={2000}
                          />
                          <button
                            type="button"
                            className="kg-pill kg-pill-red kg-pill-sm sm:col-span-2"
                            disabled={ghostEditBusy[p.id]}
                            onClick={() => doEditGhost(p.id)}
                          >
                            {ghostEditBusy[p.id] ? '儲存中…' : '儲存'}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="fld-Relations-6" className="kg-label">你眼中的 TA（稱呼）*</label>
                <input id="fld-Relations-6" className="kg-input" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="例：霧中剪" maxLength={20} />
              </div>
              <div>
                <label htmlFor="fld-Relations-7" className="kg-label">關係註記</label>
                <input id="fld-Relations-7" className="kg-input" value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="你這側的註記，牽成後公開" maxLength={200} />
              </div>
              <div className="opacity-60">
                <label htmlFor="fld-Relations-8" className="kg-label">TA 眼中的你</label>
                <input id="fld-Relations-8" className="kg-input" value="由對方回應時填寫" disabled />
              </div>
              <div className="opacity-60">
                <label htmlFor="fld-Relations-9" className="kg-label">關係註記</label>
                <input id="fld-Relations-9" className="kg-input" value="由對方回應時填寫" disabled />
              </div>
            </div>

            {formError && <ErrorBox>{formError}</ErrorBox>}
            <button type="button" className="kg-pill kg-pill-red" disabled={busy} onClick={doInitiate}>
              {busy ? '送出中…' : '發出牽線 →'}
            </button>
            <p className="font-mono2 text-[11px] text-[#6f6156]">＊ 發起時只寫你這側；對方補完後關係才公開。同一對角色只會有一條紀錄。</p>
          </div>
        </section>
      </div>
    </ProjectShell>
  );
}
