// services/relation.ts — 移植 store.ts 的牽線相關函式。
// 狀態機 §5：pending → accepted / declined；declined 再邀請＝更新同一列回 pending。
// 正規化：a_id < b_id（字串比較），同一對角色只有一列。
// 接受牽線＝update + 動態，兩筆寫入包 db.batch()。
// charId 一律是公開短碼（characters.id）。

import { and, eq, or } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { events, relations, type RelationRow } from '../db/schema';
import { getCharRaw } from './character';
import { fromJson, type RelationExtra } from './shapes';

type DB = DrizzleD1Database;

export function sideOf(rel: RelationRow, charId: string): 'a' | 'b' | null {
  if (rel.aId === charId) return 'a';
  if (rel.bId === charId) return 'b';
  return null;
}

export function toRel(r: RelationRow) {
  return {
    id: r.id,
    project_id: r.projectId,
    a_id: r.aId,
    b_id: r.bId,
    a_label: r.aLabel,
    a_note: r.aNote,
    b_label: r.bLabel,
    b_note: r.bNote,
    extras: fromJson<RelationExtra[]>(r.extras, []),
    status: r.status,
    initiator: r.initiator,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

async function getRelRaw(db: DB, projectId: string, relId: number) {
  const rows = await db.select().from(relations)
    .where(and(eq(relations.projectId, projectId), eq(relations.id, relId))).limit(1);
  return rows[0];
}

// ---- 發起邀請 ----

export async function initiate(
  db: DB,
  projectId: string,
  fromId: string,
  targetId: string,
  label: string,
  note: string,
  extras: RelationExtra[],
): Promise<{ ok: true; relation: ReturnType<typeof toRel> } | { error: string }> {
  if (fromId === targetId) return { error: '不能跟自己牽線' };
  const from = await getCharRaw(db, projectId, fromId);
  const to = await getCharRaw(db, projectId, targetId);
  if (!from || !to) return { error: '角色不存在' };
  if (from.status !== 'active' || to.status !== 'active') return { error: '角色尚未公開，暫時不能牽線' };

  const [aId, bId] = fromId < targetId ? [fromId, targetId] : [targetId, fromId];
  const initiator: 'a' | 'b' = fromId === aId ? 'a' : 'b';
  const now = Date.now();

  const existing = await db.select().from(relations)
    .where(and(eq(relations.aId, aId), eq(relations.bId, bId))).limit(1);

  if (existing[0]) {
    const r = existing[0];
    if (r.status === 'accepted') return { error: '已經牽線了' };
    if (r.status === 'pending') return { error: '已有等待回應的邀請' };
    // declined → 再邀請：更新同一列回 pending，重置雙方欄位
    await db.update(relations)
      .set({
        status: 'pending',
        initiator,
        aLabel: initiator === 'a' ? label : '',
        aNote: initiator === 'a' ? note : '',
        bLabel: initiator === 'b' ? label : '',
        bNote: initiator === 'b' ? note : '',
        extras,
        updatedAt: now,
      })
      .where(eq(relations.id, r.id));
    const updated = (await getRelRaw(db, projectId, r.id))!;
    return { ok: true, relation: toRel(updated) };
  }

  const inserted = await db.insert(relations).values({
    projectId,
    aId,
    bId,
    aLabel: initiator === 'a' ? label : '',
    aNote: initiator === 'a' ? note : '',
    bLabel: initiator === 'b' ? label : '',
    bNote: initiator === 'b' ? note : '',
    extras,
    status: 'pending',
    initiator,
    createdAt: now,
    updatedAt: now,
  }).returning();
  return { ok: true, relation: toRel(inserted[0]) };
}

// ---- 回應邀請（接受＝update + relation_accepted 動態，batch）----

export async function respond(
  db: DB,
  projectId: string,
  relId: number,
  actorCharId: string,
  action: 'accept' | 'decline',
  label: string,
  note: string,
): Promise<{ ok: true; relation: ReturnType<typeof toRel> } | { error: string }> {
  const r = await getRelRaw(db, projectId, relId);
  if (!r) return { error: '邀請不存在' };
  if (r.status !== 'pending') return { error: '這個邀請已經處理過了' };
  const side = sideOf(r, actorCharId);
  if (!side) return { error: '你不是這條牽線的當事人' };
  if (r.initiator === side) return { error: '要等對方回應，不能自己接受' };
  const now = Date.now();

  const set: Record<string, unknown> = {
    status: action === 'accept' ? 'accepted' : 'declined',
    updatedAt: now,
  };
  if (action === 'accept') {
    if (side === 'a') { set.aLabel = label; set.aNote = note; }
    else { set.bLabel = label; set.bNote = note; }
  }
  const updateStmt = db.update(relations).set(set).where(eq(relations.id, r.id)).returning();

  if (action === 'accept') {
    const a = await getCharRaw(db, projectId, r.aId);
    const b = await getCharRaw(db, projectId, r.bId);
    await db.batch([
      updateStmt,
      db.insert(events).values({
        projectId,
        type: 'relation_accepted',
        actorId: r.aId,
        targetId: r.bId,
        payload: { a: a?.name ?? '', b: b?.name ?? '' },
        createdAt: now,
      }).returning(),
    ]);
  } else {
    await updateStmt;
  }
  const updated = (await getRelRaw(db, projectId, relId))!;
  return { ok: true, relation: toRel(updated) };
}

// ---- 更新自己這側的稱呼／備註 ----

export async function patchSide(
  db: DB,
  projectId: string,
  relId: number,
  actorCharId: string,
  label: string,
  note: string,
): Promise<{ ok: true } | { error: string }> {
  const r = await getRelRaw(db, projectId, relId);
  if (!r) return { error: '牽線不存在' };
  if (r.status !== 'accepted') return { error: '牽線成立後才能編輯' };
  const side = sideOf(r, actorCharId);
  if (!side) return { error: '你不是這條牽線的當事人' };
  await db.update(relations)
    .set(side === 'a'
      ? { aLabel: label, aNote: note, updatedAt: Date.now() }
      : { bLabel: label, bNote: note, updatedAt: Date.now() })
    .where(eq(relations.id, r.id));
  return { ok: true };
}

// ---- 雙方共編的「其他補充」區塊（整組取代）----

export async function patchExtras(
  db: DB,
  projectId: string,
  relId: number,
  actorCharId: string,
  extras: RelationExtra[],
): Promise<{ ok: true } | { error: string }> {
  const r = await getRelRaw(db, projectId, relId);
  if (!r) return { error: '牽線不存在' };
  if (r.status !== 'accepted') return { error: '牽線成立後才能編輯' };
  if (!sideOf(r, actorCharId)) return { error: '你不是這條牽線的當事人' };
  await db.update(relations)
    .set({ extras, updatedAt: Date.now() })
    .where(eq(relations.id, r.id));
  return { ok: true };
}

// ---- 斷線（刪列；角色才 soft-delete，§6.8）----

export async function unwire(
  db: DB,
  projectId: string,
  relId: number,
  actorCharId: string,
): Promise<{ ok: true } | { error: string }> {
  const r = await getRelRaw(db, projectId, relId);
  if (!r) return { error: '牽線不存在' };
  if (!sideOf(r, actorCharId)) return { error: '你不是這條牽線的當事人' };
  await db.delete(relations).where(eq(relations.id, r.id));
  return { ok: true };
}

// ---- 查詢 ----

// 當事人視角（牽線管理頁）：全部狀態都回；路由層已驗當事人或開設者身分
export async function forChar(db: DB, projectId: string, charId: string) {
  const rows = await db.select().from(relations)
    .where(and(eq(relations.projectId, projectId), or(eq(relations.aId, charId), eq(relations.bId, charId))));
  return rows.sort((a, b) => b.updatedAt - a.updatedAt).map(toRel);
}

export async function accepted(db: DB, projectId: string) {
  const rows = await db.select().from(relations)
    .where(and(eq(relations.projectId, projectId), eq(relations.status, 'accepted')));
  return rows.sort((a, b) => b.updatedAt - a.updatedAt).map(toRel);
}
