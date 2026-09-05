// services/project.test.ts
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, expect, it } from 'vitest';
import { characters } from '../db/schema';
import * as projectSvc from './project';
import * as charSvc from './character';

const db = drizzle(env.DB);

describe('createProject', () => {
  it('建立企劃時把 owner_discord_id 寫進去，回應不含任何權杖欄位', async () => {
    const r = await projectSvc.createProject(
      db,
      { title: '測試企劃', summary: '', join_mode: 'open' },
      'discord_123',
    );
    expect(r.project.title).toBe('測試企劃');
    expect('ownerToken' in r).toBe(false);
    expect('transferCode' in r).toBe(false);
  });
});

describe('加入碼大小寫/空白容錯（0-1）', () => {
  it('設定含空白與大寫的加入碼，用不同大小寫與有無空白都能加入', async () => {
    const r = await projectSvc.createProject(
      db,
      { title: '加入碼測試企劃', summary: '', join_mode: 'code', join_code: 'Fog 2026' },
      'discord_owner',
    );
    expect(r.project.has_join_code).toBe(true);

    const ok1 = await charSvc.joinProject(db, r.project.slug, 'd_a', { name: '角色A', join_code: 'fog2026' });
    expect('ok' in ok1).toBe(true);

    const ok2 = await charSvc.joinProject(db, r.project.slug, 'd_b', { name: '角色B', join_code: ' FOG2026 ' });
    expect('ok' in ok2).toBe(true);

    const bad = await charSvc.joinProject(db, r.project.slug, 'd_c', { name: '角色C', join_code: '完全不對' });
    expect('error' in bad).toBe(true);
  });
});

describe('dashboardFor', () => {
  it('列出自己開的企劃與自己的角色（跨企劃分組）', async () => {
    const discordId = `d_${crypto.randomUUID().slice(0, 8)}`;
    const other = `d_${crypto.randomUUID().slice(0, 8)}`;
    await projectSvc.createProject(db, { title: '企劃甲', summary: '', join_mode: 'open' }, discordId);
    const r2 = await projectSvc.createProject(db, { title: '企劃乙', summary: '', join_mode: 'open' }, other);
    const now = Date.now();
    await db.insert(characters).values({
      id: 'CHAR-0001', projectId: r2.project.id, name: '角色A', status: 'active', discordId, createdAt: now, updatedAt: now,
    });

    const data = await projectSvc.dashboardFor(db, discordId);
    expect(data.owned_projects.map((p) => p.title)).toEqual(['企劃甲']);
    expect(data.characters).toHaveLength(1);
    expect(data.characters[0].project_slug).toBe(r2.project.slug);
    expect(data.characters[0].project_title).toBe('企劃乙');
  });

  it('已移除的角色不列入', async () => {
    const discordId = `d_${crypto.randomUUID().slice(0, 8)}`;
    const r = await projectSvc.createProject(db, { title: '企劃丙', summary: '', join_mode: 'open' }, `d_${crypto.randomUUID().slice(0, 8)}`);
    const now = Date.now();
    await db.insert(characters).values({
      id: 'CHAR-0002', projectId: r.project.id, name: '角色B', status: 'removed', discordId, createdAt: now, updatedAt: now,
    });
    const data = await projectSvc.dashboardFor(db, discordId);
    expect(data.characters).toHaveLength(0);
  });
});
