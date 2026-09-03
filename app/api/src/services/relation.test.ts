// relation.ts 狀態機的回歸測試（pending → accepted / declined，declined 重邀更新同列）。
// 這段邏輯在 code review 被標為「不簡單，完全靠人工核對」，補上這份測試防迴歸。
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { beforeEach, describe, expect, it } from 'vitest';
import { characters, projects } from '../db/schema';
import * as rel from './relation';

const db = drizzle(env.DB);

let projectId: string;
let aId: string; // 較小的公開碼（正規化後的 a）
let bId: string; // 較大的公開碼
let draftId: string; // 未公開角色

beforeEach(async () => {
  projectId = `prj_test_${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();
  await db.insert(projects).values({
    id: projectId,
    slug: `slug-${projectId}`,
    title: '測試企劃',
    ownerTokenHash: 'x',
    createdAt: now,
    updatedAt: now,
  });

  const c1 = `AAAA-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  const c2 = `ZZZZ-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  // a_id < b_id 是 relation.ts 自己排序的，這裡先建兩個角色，測試裡再依實際回傳的 aId/bId 取用
  await db.insert(characters).values([
    { id: c1, projectId, name: '角色A', status: 'active', editTokenHash: 'x', createdAt: now, updatedAt: now },
    { id: c2, projectId, name: '角色B', status: 'active', editTokenHash: 'x', createdAt: now, updatedAt: now },
  ]);
  [aId, bId] = [c1, c2].sort();

  const draft = `DDDD-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  await db.insert(characters).values({
    id: draft, projectId, name: '未公開角色', status: 'draft', editTokenHash: 'x', createdAt: now, updatedAt: now,
  });
  draftId = draft;
});

describe('initiate', () => {
  it('rejects relating to yourself', async () => {
    const r = await rel.initiate(db, projectId, aId, aId, 'label', 'note', []);
    expect(r).toEqual({ error: '不能跟自己牽線' });
  });

  it('rejects when the target character is still draft (not yet public)', async () => {
    const r = await rel.initiate(db, projectId, aId, draftId, 'label', 'note', []);
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error).toContain('尚未公開');
  });

  it('creates a pending relation with a_id < b_id regardless of who initiates', async () => {
    const r = await rel.initiate(db, projectId, bId, aId, '我眼中的你', '', []); // b 發起邀請 a
    expect('ok' in r).toBe(true);
    if (!('ok' in r)) return;
    expect(r.relation.a_id).toBe(aId);
    expect(r.relation.b_id).toBe(bId);
    expect(r.relation.status).toBe('pending');
    expect(r.relation.initiator).toBe('b'); // bId 排序後是 b 側
    expect(r.relation.b_label).toBe('我眼中的你');
    expect(r.relation.a_label).toBe('');
  });

  it('rejects a second invite while one is already pending', async () => {
    await rel.initiate(db, projectId, aId, bId, 'x', '', []);
    const r2 = await rel.initiate(db, projectId, aId, bId, 'y', '', []);
    expect(r2).toEqual({ error: '已有等待回應的邀請' });
  });

  it('rejects a new invite once the pair is already accepted', async () => {
    await rel.initiate(db, projectId, aId, bId, 'x', '', []);
    const relId = await firstRelationId();
    await rel.respond(db, projectId, relId, bId, 'accept', 'reply', '');
    const r2 = await rel.initiate(db, projectId, aId, bId, 'z', '', []);
    expect(r2).toEqual({ error: '已經牽線了' });
  });

  it('re-inviting after a decline resets the same row to pending with roles swapped', async () => {
    await rel.initiate(db, projectId, aId, bId, 'first', '', []);
    const relId = await firstRelationId();
    await rel.respond(db, projectId, relId, bId, 'decline', '', '');

    const r2 = await rel.initiate(db, projectId, bId, aId, 'second', '', []);
    expect('ok' in r2).toBe(true);
    if (!('ok' in r2)) return;
    expect(r2.relation.id).toBe(relId); // 同一列，不是新插一列
    expect(r2.relation.status).toBe('pending');
    expect(r2.relation.initiator).toBe('b');
    expect(r2.relation.b_label).toBe('second');
    expect(r2.relation.a_label).toBe(''); // 舊資料被清空重置
  });
});

describe('respond', () => {
  it('rejects the initiator accepting their own invite', async () => {
    await rel.initiate(db, projectId, aId, bId, 'x', '', []);
    const relId = await firstRelationId();
    const r = await rel.respond(db, projectId, relId, aId, 'accept', 'y', '');
    expect(r).toEqual({ error: '要等對方回應，不能自己接受' });
  });

  it('rejects a non-participant responding', async () => {
    await rel.initiate(db, projectId, aId, bId, 'x', '', []);
    const relId = await firstRelationId();
    const r = await rel.respond(db, projectId, relId, draftId, 'accept', 'y', '');
    expect(r).toEqual({ error: '你不是這條牽線的當事人' });
  });

  it('rejects responding to an already-resolved invite', async () => {
    await rel.initiate(db, projectId, aId, bId, 'x', '', []);
    const relId = await firstRelationId();
    await rel.respond(db, projectId, relId, bId, 'accept', 'y', '');
    const r2 = await rel.respond(db, projectId, relId, bId, 'accept', 'y2', '');
    expect(r2).toEqual({ error: '這個邀請已經處理過了' });
  });

  it('accept sets the accepting side label/note and flips status', async () => {
    await rel.initiate(db, projectId, aId, bId, 'a-side', '', []);
    const relId = await firstRelationId();
    const r = await rel.respond(db, projectId, relId, bId, 'accept', 'b-side label', 'b-side note');
    expect('ok' in r).toBe(true);
    if (!('ok' in r)) return;
    expect(r.relation.status).toBe('accepted');
    expect(r.relation.b_label).toBe('b-side label');
    expect(r.relation.b_note).toBe('b-side note');
    expect(r.relation.a_label).toBe('a-side'); // 對方原本的邀請內容不變
  });
});

describe('patchSide / patchExtras / unwire require accepted + participant', () => {
  it('rejects editing a side before the relation is accepted', async () => {
    await rel.initiate(db, projectId, aId, bId, 'x', '', []);
    const relId = await firstRelationId();
    const r = await rel.patchSide(db, projectId, relId, aId, 'new', 'note');
    expect(r).toEqual({ error: '牽線成立後才能編輯' });
  });

  it('rejects a non-participant unwiring', async () => {
    await rel.initiate(db, projectId, aId, bId, 'x', '', []);
    const relId = await firstRelationId();
    await rel.respond(db, projectId, relId, bId, 'accept', 'y', '');
    const r = await rel.unwire(db, projectId, relId, draftId);
    expect(r).toEqual({ error: '你不是這條牽線的當事人' });
  });

  it('unwire hard-deletes the row (no soft-delete for relations)', async () => {
    await rel.initiate(db, projectId, aId, bId, 'x', '', []);
    const relId = await firstRelationId();
    await rel.respond(db, projectId, relId, bId, 'accept', 'y', '');
    const r = await rel.unwire(db, projectId, relId, aId);
    expect(r).toEqual({ ok: true });
    const remaining = await rel.forChar(db, projectId, aId);
    expect(remaining.find((x) => x.id === relId)).toBeUndefined();
  });
});

async function firstRelationId(): Promise<number> {
  const rows = await rel.forChar(db, projectId, aId);
  if (!rows[0]) throw new Error('no relation found in test setup');
  return rows[0].id;
}
