// services/event.ts — 動態牆。LIMIT 30，cursor＝created_at（before 參數）。
// 前端已經有角色清單（listCharacters），名字解析在客戶端做，這裡不 join。

import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { events } from '../db/schema';
import { fromJson } from './shapes';

type DB = DrizzleD1Database;

export const FEED_LIMIT = 30;

export async function feed(db: DB, projectId: string, before?: number) {
  const conds: SQL[] = [eq(events.projectId, projectId)];
  if (before) conds.push(lt(events.createdAt, before));
  const rows = await db
    .select()
    .from(events)
    .where(and(...conds))
    .orderBy(desc(events.createdAt))
    .limit(FEED_LIMIT);
  return rows.map((r) => ({
    id: r.id,
    project_id: r.projectId,
    type: r.type,
    actor_id: r.actorId,
    target_id: r.targetId,
    payload: fromJson<Record<string, string>>(r.payload, {}),
    created_at: r.createdAt,
  }));
}
