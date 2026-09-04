// services/project.test.ts
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, expect, it } from 'vitest';
import { characters } from '../db/schema';
import * as projectSvc from './project';

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
