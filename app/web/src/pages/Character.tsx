import { useEffect, useMemo, useState } from 'react';
import { acceptedRelations, getCharacter, listCharacters, rotateCharToken, sideOf, verifyCharToken, type CharacterView } from '../lib/api';
import { href } from '../lib/nav';
import { PageLoading, BlockView, CharAvatar, EmptyNote, ErrorBox, FieldView, PreviewModal, SecLabel, ThreadLink, TokenReveal, toast, type PreviewTarget, type RosterLite } from '../components/kg';
import { SocialLinkChips } from '../components/links';
import { ProjectShell } from '../components/project-shell';
import type { Character, Relation } from '../lib/types';

export default function CharacterPage({ slug, charId }: { slug: string; charId: string }) {
  const [data, setData] = useState<CharacterView | null | undefined>(undefined);
  const [rels, setRels] = useState<Relation[]>([]);
  const [charMap, setCharMap] = useState<Map<string, Character>>(new Map());
  const [owned, setOwned] = useState(false);
  const [isOwner, setIsOwner] = useState(false); // 開設者（可看私人欄位）
  const [claimToken, setClaimToken] = useState('');
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);
  const [preview, setPreview] = useState<{ block: PreviewTarget; idx: number } | null>(null);
  // 1-4：重看編輯碼——不是找回原本那組（權杖只存雜湊拿不回來），是換發一組新的
  const [newToken, setNewToken] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  const refresh = async () => {
    // 1-2：三條查詢彼此不依賴，並行抓，不要排隊
    const [got, all, chars] = await Promise.all([
      getCharacter(slug, charId),
      acceptedRelations(slug),
      listCharacters(slug),
    ]);
    setData(got);
    if (!got) return;
    setRels(all.filter((r) => r.a_id === charId || r.b_id === charId));
    setCharMap(new Map(chars.map((c) => [c.id, c])));
    // 身分由伺服器依 cookie 推斷
    setOwned(got.viewer.owned);
    setIsOwner(got.viewer.isOwner);
    document.title = `${got.character.name} — ${got.project.title} — 牽關`;
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, charId]);

  const filledFields = useMemo(() => {
    if (!data) return [];
    // 私人欄位：只有角色本人（或開設者）看得見
    const canSeePrivate = owned || isOwner;
    return data.project.field_schema.filter(
      (f) => (data.character.profile[f.key] ?? '').trim() && (canSeePrivate || (f.visibility ?? 'public') !== 'private'),
    );
  }, [data, owned, isOwner]);

  const rosterLite: RosterLite[] = useMemo(() => [...charMap.values()].map((c) => ({ id: c.id, name: c.name, avatar_url: c.avatar_url })), [charMap]);

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

  const { project, character } = data;

  const claim = async () => {
    setClaimError(null);
    const ok = await verifyCharToken(slug, charId, claimToken); // 驗過後端種 cookie
    if (!ok) return setClaimError('企劃不存在或權杖錯誤');
    setClaimOpen(false);
    setClaimToken('');
    refresh();
  };

  const doRotate = async () => {
    if (!window.confirm('重新產生編輯碼會讓舊的那組失效（這台裝置會自動換成新的，不影響現在的存取）。確定要繼續嗎？')) return;
    setRotating(true);
    try {
      const res = await rotateCharToken(slug, charId);
      if (!res.ok) {
        toast(res.error, 'err');
        return;
      }
      setNewToken(res.charToken);
    } finally {
      setRotating(false);
    }
  };

  return (
    <ProjectShell slug={slug} title={project.title} active={null}>
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 w-full">
        <a href={href(`/p/${slug}`)} className="font-mono2 text-xs text-[#6f6156] hover:text-[#9e4b2c]">
          ← {project.title}
        </a>

        <div className="flex flex-col sm:flex-row gap-6 items-start mt-5 kg-rise">
          <CharAvatar name={character.name} url={character.avatar_url} size={110} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-huninn text-4xl">{character.name}</h1>
              <span className="font-mono2 text-xs text-[#6f6156]">{character.id}</span>
              {character.slot && (
                <span className="kg-tag" style={{ background: '#fcebf0', color: '#a8455e' }}>
                  空位・等人加入
                </span>
              )}
              {!character.slot && character.status === 'draft' && (
                <span className="kg-tag" style={{ background: '#fcebf0', color: '#a8455e' }}>
                  草稿・待認領
                </span>
              )}
            </div>
            {character.one_liner && <p className="mt-2 text-lg text-[#4a3b31] leading-relaxed">{character.one_liner}</p>}
            {(character.tags ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {(character.tags ?? []).map((t) => (
                  <span key={t} className="kg-tag">{t}</span>
                ))}
              </div>
            )}
            <div className="mt-3">
              <SocialLinkChips links={character.links} />
            </div>
            <div className="flex flex-wrap gap-2.5 mt-4">
              {owned ? (
                <>
                  <a href={href(`/p/${slug}/c/${charId}/edit`)} className="kg-pill kg-pill-sm">
                    編輯角色
                  </a>
                  <a href={href(`/p/${slug}/c/${charId}/relations`)} className="kg-pill kg-pill-sm kg-pill-sage">
                    牽線管理
                  </a>
                  <button type="button" className="kg-pill kg-pill-sm kg-pill-ghost" disabled={rotating} onClick={() => { void doRotate(); }}>
                    {rotating ? '產生中…' : '重看編輯碼'}
                  </button>
                </>
              ) : character.slot ? (
                <a href={href(`/p/${slug}/join?claim=${encodeURIComponent(character.name)}`)} className="kg-pill kg-pill-sm kg-pill-red">
                  用「{character.name}」加入以認領
                </a>
              ) : (
                <button type="button" className="kg-pill kg-pill-sm kg-pill-ghost" onClick={() => setClaimOpen((v) => !v)}>
                  這是我的角色
                </button>
              )}
            </div>
            {claimOpen && !owned && (
              <div className="kg-card-flat p-4 mt-4 max-w-md">
                <label htmlFor="fld-Character-1" className="kg-label">貼上角色編輯碼以解鎖</label>
                <input id="fld-Character-1" className="kg-input font-mono2" value={claimToken} onChange={(e) => setClaimToken(e.target.value)} placeholder="chr_…" autoComplete="off" />
                {claimError && (
                  <div className="mt-2">
                    <ErrorBox>{claimError}</ErrorBox>
                  </div>
                )}
                <button type="button" className="kg-pill kg-pill-red kg-pill-sm mt-3" onClick={claim}>
                  驗證
                </button>
              </div>
            )}
          </div>
        </div>

        {newToken && (
          <div className="mt-6 max-w-md">
            <TokenReveal kind="char" token={newToken} note="這組取代了舊的編輯碼；舊的那組現在已經失效。">
              <button type="button" className="kg-pill" onClick={() => setNewToken(null)}>
                好，關掉這張卡
              </button>
            </TokenReveal>
          </div>
        )}

        {filledFields.length > 0 && (
          <section className="mt-10 kg-rise" style={{ animationDelay: '0.08s' }}>
            <SecLabel>設定</SecLabel>
            <div className="kg-card-flat mt-3 divide-y-2 divide-dashed divide-[#33261e]/20">
              {filledFields.map((f) => (
                <div key={f.key} className="grid grid-cols-[110px_1fr] gap-4 px-5 py-3">
                  <div className="kg-seclabel self-center">（{f.label}）</div>
                  <div className="text-sm leading-relaxed">
                    <FieldView def={f} value={character.profile[f.key]} slug={slug} roster={rosterLite} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {character.blocks.length > 0 && (
          <section className="mt-10 kg-rise" style={{ animationDelay: '0.12s' }}>
            <SecLabel>角色卡</SecLabel>
            <div className="space-y-4 mt-3">
              {character.blocks.map((b) => (
                <BlockView
                  key={b.id}
                  block={b}
                  slug={slug}
                  roster={rosterLite}
                  canSeePrivate={owned || isOwner}
                  onPreview={(t, i) => setPreview({ block: t, idx: i })}
                />
              ))}
            </div>
          </section>
        )}

        <section className="mt-10 kg-rise" style={{ animationDelay: '0.16s' }}>
          <SecLabel>關係</SecLabel>
          <h2 className="font-huninn text-2xl mt-1.5 mb-4">已牽成的關係</h2>
          {rels.length === 0 ? (
            <EmptyNote>還沒有公開的關係線。</EmptyNote>
          ) : (
            <div className="space-y-4">
              {rels.map((r) => {
                const side = sideOf(r, charId)!;
                const otherId = side === 'a' ? r.b_id : r.a_id;
                const other = charMap.get(otherId);
                if (!other) return null;
                const myLabel = side === 'a' ? r.a_label : r.b_label;
                const myNote = side === 'a' ? r.a_note : r.b_note;
                const theirLabel = side === 'a' ? r.b_label : r.a_label;
                const theirNote = side === 'a' ? r.b_note : r.a_note;
                return (
                  <div key={r.id} className="kg-card p-5">
                    <div className="flex items-center gap-3 flex-wrap">
                      <a href={href(`/p/${slug}/c/${other.id}`)} className="flex items-center gap-2.5 font-bold hover:text-[#9e4b2c]">
                        <CharAvatar name={other.name} url={other.avatar_url} size={40} />
                        <span className="text-lg">{other.name}</span>
                      </a>
                      <ThreadLink className="w-12" />
                      {myLabel && theirLabel && (
                        <span className="kg-tag">
                          {myLabel} ⇄ {theirLabel}
                        </span>
                      )}
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4 mt-4">
                      <div>
                        <div className="kg-seclabel mb-1">（{character.name} 眼中的 {other.name}）</div>
                        <p className="text-sm leading-relaxed">{myNote || '—'}</p>
                      </div>
                      <div>
                        <div className="kg-seclabel mb-1">（{other.name} 眼中的 {character.name}）</div>
                        <p className="text-sm leading-relaxed">{theirNote || '—'}</p>
                      </div>
                    </div>
                    {r.notes.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-dashed border-[#e8dfd4] space-y-3">
                        {r.notes.map((n) => (
                          <p key={n.id} className="text-sm leading-relaxed whitespace-pre-wrap text-[#4a3b31]">{n.body}</p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="font-mono2 text-[11px] text-[#6f6156] mt-3">＊ 待確認與已婉拒的牽線只有雙方看得到。</p>
        </section>
      </div>
      {preview && <PreviewModal block={preview.block} startIndex={preview.idx} onClose={() => setPreview(null)} />}
    </ProjectShell>
  );
}
