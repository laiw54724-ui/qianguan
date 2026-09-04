import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { beforeEach, describe, expect, it } from 'vitest';
import { characters, projects } from '../db/schema';
import * as priv from './privateRelation';

const db = drizzle(env.DB);

let projectId: string;
let ownerCharId: string;

beforeEach(async () => {
  projectId = `prj_test_${crypto.randomUUID().slice(0, 8)}`;
  const slug = `slug-${projectId}`;
  const now = Date.now();
  await db.insert(projects).values({ id: projectId, slug, title: '測試企劃', createdAt: now, updatedAt: now });
  ownerCharId = `chr_owner_${crypto.randomUUID().slice(0, 8)}`;
  await db.insert(characters).values({
    id: ownerCharId, projectId, name: '我的角色', status: 'active', createdAt: now, updatedAt: now,
  });
});

describe('create / listFor', () => {
  it('建立一筆私人紀錄，列表看得到', async () => {
    const r = await priv.create(db, projectId, ownerCharId, '阿楠', '朋友', '常常一起冒險');
    expect(r.ok).toBe(true);
    const rows = await priv.listFor(db, projectId, ownerCharId);
    expect(rows).toHaveLength(1);
    expect(rows[0].ghost_name).toBe('阿楠');
  });

  it('沒有同名真人角色時 suggested_char_id 是 null', async () => {
    await priv.create(db, projectId, ownerCharId, '阿楠', '', '');
    const rows = await priv.listFor(db, projectId, ownerCharId);
    expect(rows[0].suggested_char_id).toBeNull();
  });

  it('企劃裡有同名真人角色時 suggested_char_id 帶那個角色的 id', async () => {
    const now = Date.now();
    const realCharId = `chr_real_${crypto.randomUUID().slice(0, 8)}`;
    await db.insert(characters).values({
      id: realCharId, projectId, name: '阿楠', status: 'active', createdAt: now, updatedAt: now,
    });
    await priv.create(db, projectId, ownerCharId, '阿楠', '', '');
    const rows = await priv.listFor(db, projectId, ownerCharId);
    expect(rows[0].suggested_char_id).toBe(realCharId);
  });

  it('draft 狀態的同名角色不算建議對象（還沒公開）', async () => {
    const now = Date.now();
    const draftCharId = `chr_draft_${crypto.randomUUID().slice(0, 8)}`;
    await db.insert(characters).values({
      id: draftCharId, projectId, name: '阿楠', status: 'draft', createdAt: now, updatedAt: now,
    });
    await priv.create(db, projectId, ownerCharId, '阿楠', '', '');
    const rows = await priv.listFor(db, projectId, ownerCharId);
    expect(rows[0].suggested_char_id).toBeNull();
  });

  it('不同角色的私人紀錄互不可見', async () => {
    const now = Date.now();
    const otherOwnerId = `chr_other_${crypto.randomUUID().slice(0, 8)}`;
    await db.insert(characters).values({
      id: otherOwnerId, projectId, name: '別人的角色', status: 'active', createdAt: now, updatedAt: now,
    });
    await priv.create(db, projectId, ownerCharId, '阿楠', '', '');
    const rows = await priv.listFor(db, projectId, otherOwnerId);
    expect(rows).toEqual([]);
  });
});

describe('update / remove', () => {
  it('只有這個角色的擁有者能改自己的紀錄', async () => {
    const created = await priv.create(db, projectId, ownerCharId, '阿楠', '', '');
    const ok = await priv.update(db, ownerCharId, created.row.id, '好朋友', '更新過的筆記');
    expect('ok' in ok && ok.ok).toBe(true);
    const rows = await priv.listFor(db, projectId, ownerCharId);
    expect(rows[0].label).toBe('好朋友');
  });

  it('別的角色不能改這筆紀錄', async () => {
    const now = Date.now();
    const otherOwnerId = `chr_other2_${crypto.randomUUID().slice(0, 8)}`;
    await db.insert(characters).values({
      id: otherOwnerId, projectId, name: '別人的角色', status: 'active', createdAt: now, updatedAt: now,
    });
    const created = await priv.create(db, projectId, ownerCharId, '阿楠', '', '');
    const r = await priv.update(db, otherOwnerId, created.row.id, '改壞', '');
    expect('error' in r).toBe(true);
  });

  it('remove 之後列表就沒了，別的角色 remove 不掉', async () => {
    const created = await priv.create(db, projectId, ownerCharId, '阿楠', '', '');
    expect(await priv.remove(db, 'not-the-owner', created.row.id)).toBe(false);
    expect(await priv.remove(db, ownerCharId, created.row.id)).toBe(true);
    expect(await priv.listFor(db, projectId, ownerCharId)).toEqual([]);
  });
});
