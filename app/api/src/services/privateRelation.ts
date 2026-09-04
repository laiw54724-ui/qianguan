// services/privateRelation.ts — private_relations 表的存取層（規格 1.5-2）
// 完全私人：只有 owner_char_id 對應的角色本人看得到，路由層用既有的 requireChar 驗證身分，
// 這裡的每個函式都額外拿 ownerCharId 當篩選條件，雙重確保不會回錯人的資料。
import { and, eq, ne } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { characters, privateRelations } from '../db/schema';

type DB = DrizzleD1Database;

export interface PrivateRelationView {
  id: number;
  ghost_name: string;
  label: string;
  note: string;
  linked_char_id: string | null;
  suggested_char_id: string | null;
  created_at: number;
  updated_at: number;
}

export async function create(
  d: DB,
  projectId: string,
  ownerCharId: string,
  ghostName: string,
  label: string,
  note: string,
): Promise<{ ok: true; row: PrivateRelationView }> {
  const now = Date.now();
  const inserted = await d.insert(privateRelations).values({
    projectId, ownerCharId, ghostName: ghostName.trim(), label, note, createdAt: now, updatedAt: now,
  }).returning();
  const row = inserted[0];
  return {
    ok: true,
    row: {
      id: row.id, ghost_name: row.ghostName, label: row.label, note: row.note,
      linked_char_id: row.linkedCharId, suggested_char_id: null, created_at: row.createdAt, updated_at: row.updatedAt,
    },
  };
}

/** 列出這個角色所有私人紀錄，附上「站上有沒有同名真人角色」的轉正建議——
 * 只比對 active 狀態的角色（draft 還沒公開，不該被當成建議對象），只給建議不自動轉換。 */
export async function listFor(d: DB, projectId: string, ownerCharId: string): Promise<PrivateRelationView[]> {
  const rows = await d.select().from(privateRelations)
    .where(and(eq(privateRelations.projectId, projectId), eq(privateRelations.ownerCharId, ownerCharId)));
  if (!rows.length) return [];

  const names = [...new Set(rows.filter((r) => !r.linkedCharId).map((r) => r.ghostName))];
  const nameToCharId = new Map<string, string>();
  if (names.length) {
    const matches = await d.select().from(characters)
      .where(and(eq(characters.projectId, projectId), eq(characters.status, 'active'), ne(characters.id, ownerCharId)));
    for (const c of matches) {
      if (names.includes(c.name) && !nameToCharId.has(c.name)) nameToCharId.set(c.name, c.id);
    }
  }

  return rows
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((r) => ({
      id: r.id, ghost_name: r.ghostName, label: r.label, note: r.note, linked_char_id: r.linkedCharId,
      suggested_char_id: r.linkedCharId ? null : (nameToCharId.get(r.ghostName) ?? null),
      created_at: r.createdAt, updated_at: r.updatedAt,
    }));
}

export async function update(
  d: DB,
  ownerCharId: string,
  id: number,
  label: string,
  note: string,
): Promise<{ ok: true } | { error: string }> {
  const rows = await d.select({ id: privateRelations.id }).from(privateRelations)
    .where(and(eq(privateRelations.id, id), eq(privateRelations.ownerCharId, ownerCharId))).limit(1);
  if (!rows.length) return { error: '紀錄不存在' };
  await d.update(privateRelations).set({ label, note, updatedAt: Date.now() }).where(eq(privateRelations.id, id));
  return { ok: true };
}

export async function remove(d: DB, ownerCharId: string, id: number): Promise<boolean> {
  const rows = await d.select({ id: privateRelations.id }).from(privateRelations)
    .where(and(eq(privateRelations.id, id), eq(privateRelations.ownerCharId, ownerCharId))).limit(1);
  if (!rows.length) return false;
  await d.delete(privateRelations).where(eq(privateRelations.id, id));
  return true;
}

/** 轉正之後這筆私人紀錄就沒有意義了（真的關係走 relations 表），標記已連結而不是直接刪除，
 * 讓使用者自己在列表上看得到「這筆已經變成正式牽線」。呼叫端（路由層）負責先呼叫既有的
 * relSvc.initiate() 送出正式邀請，成功後才呼叫這個函式標記。 */
export async function markLinked(d: DB, ownerCharId: string, id: number, linkedCharId: string): Promise<boolean> {
  const rows = await d.select({ id: privateRelations.id }).from(privateRelations)
    .where(and(eq(privateRelations.id, id), eq(privateRelations.ownerCharId, ownerCharId))).limit(1);
  if (!rows.length) return false;
  await d.update(privateRelations).set({ linkedCharId, updatedAt: Date.now() }).where(eq(privateRelations.id, id));
  return true;
}
