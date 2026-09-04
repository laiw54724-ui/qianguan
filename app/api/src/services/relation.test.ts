import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { beforeEach, describe, expect, it } from 'vitest';
import { characters, projects } from '../db/schema';
import * as rel from './relation';

const db = drizzle(env.DB);

let projectId: string;
let slug: string;
let aId: string;
let bId: string;

beforeEach(async () => {
  projectId = `prj_test_${crypto.randomUUID().slice(0, 8)}`;
  slug = `slug-${projectId}`;
  const now = Date.now();
  await db.insert(projects).values({ id: projectId, slug, title: '測試企劃', ownerTokenHash: 'x', createdAt: now, updatedAt: now });
  const c1 = `chr_a_${crypto.randomUUID().slice(0, 8)}`;
  const c2 = `chr_b_${crypto.randomUUID().slice(0, 8)}`;
  await db.insert(characters).values([
    { id: c1, projectId, name: '角色A', status: 'active', editTokenHash: 'x', createdAt: now, updatedAt: now },
    { id: c2, projectId, name: '角色B', status: 'active', editTokenHash: 'x', createdAt: now, updatedAt: now },
  ]);
  [aId, bId] = [c1, c2].sort();
});

async function acceptRelation() {
  const r = await rel.initiate(db, projectId, aId, bId, '朋友', '我這側');
  if (!('ok' in r)) throw new Error('setup: initiate failed');
  await rel.respond(db, projectId, r.relation.id, bId, 'accept', '朋友', '對方這側');
  return r.relation.id;
}

describe('addNote / deleteNote（relation_notes 取代 extras）', () => {
  it('accepted 狀態才能新增筆記', async () => {
    const init = await rel.initiate(db, projectId, aId, bId, '朋友', '');
    if (!('ok' in init)) throw new Error('setup failed');
    const r = await rel.addNote(db, projectId, init.relation.id, aId, '測試筆記');
    expect('error' in r).toBe(true);
  });

  it('雙方都能新增，accepted 之後才可以', async () => {
    const relId = await acceptRelation();
    const r1 = await rel.addNote(db, projectId, relId, aId, 'A 寫的筆記');
    const r2 = await rel.addNote(db, projectId, relId, bId, 'B 寫的筆記');
    expect('ok' in r1 && r1.ok).toBe(true);
    expect('ok' in r2 && r2.ok).toBe(true);
    const rows = await rel.forChar(db, projectId, aId);
    const found = rows.find((r) => r.id === relId)!;
    expect(found.notes).toHaveLength(2);
  });

  it('不是當事人不能新增', async () => {
    const relId = await acceptRelation();
    const r = await rel.addNote(db, projectId, relId, 'not-a-party', '測試');
    expect('error' in r).toBe(true);
  });

  it('只有作者能刪自己那條筆記', async () => {
    const relId = await acceptRelation();
    const added = await rel.addNote(db, projectId, relId, aId, 'A 的筆記');
    if (!('ok' in added)) throw new Error('setup failed');
    const wrongDelete = await rel.deleteNote(db, projectId, relId, added.note.id, bId);
    expect('error' in wrongDelete).toBe(true);
    const rightDelete = await rel.deleteNote(db, projectId, relId, added.note.id, aId);
    expect('ok' in rightDelete && rightDelete.ok).toBe(true);
  });
});

describe('forChar / accepted 回傳 notes，不再有 extras', () => {
  it('列表裡每筆關係都有 notes 陣列', async () => {
    const relId = await acceptRelation();
    await rel.addNote(db, projectId, relId, aId, '一條筆記');
    const rows = await rel.accepted(db, projectId);
    const found = rows.find((r) => r.id === relId)!;
    expect(found.notes).toEqual([expect.objectContaining({ body: '一條筆記', author_side: 'a' })]);
    expect((found as Record<string, unknown>).extras).toBeUndefined();
  });

  it('沒有筆記的關係 notes 是空陣列，不是 undefined', async () => {
    const relId = await acceptRelation();
    const rows = await rel.accepted(db, projectId);
    expect(rows.find((r) => r.id === relId)!.notes).toEqual([]);
  });
});
