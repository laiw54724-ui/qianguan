// character.ts 的 1-3 動態牆改主動發布的回歸測試：
// patchChar 只在第一次存檔時自動寫 char_joined，之後的存檔不再自動寫 char_updated；
// 要分享用獨立的 shareCharUpdate()。
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { events, projects } from '../db/schema';
import * as char from './character';

const db = drizzle(env.DB);

let slug: string;
let projectId: string;
let charId: string;

beforeEach(async () => {
  projectId = `prj_test_${crypto.randomUUID().slice(0, 8)}`;
  slug = `slug-${projectId}`;
  const now = Date.now();
  await db.insert(projects).values({
    id: projectId, slug, title: '測試企劃', createdAt: now, updatedAt: now,
  });

  const joined = await char.joinProject(db, slug, `d_${crypto.randomUUID().slice(0, 8)}`, { name: '測試角色' });
  if (!('ok' in joined)) throw new Error('setup: joinProject failed');
  charId = joined.character.id;
});

async function eventsFor(type?: string) {
  const rows = await db.select().from(events).where(eq(events.projectId, projectId));
  return type ? rows.filter((r) => r.type === type) : rows;
}

describe('patchChar 事件寫入（1-3）', () => {
  it('第一次存檔（draft→active）自動寫 char_joined', async () => {
    const r = await char.patchChar(db, slug, charId, { name: '測試角色' });
    expect('ok' in r).toBe(true);
    const joined = await eventsFor('char_joined');
    expect(joined).toHaveLength(1);
    const updated = await eventsFor('char_updated');
    expect(updated).toHaveLength(0);
  });

  it('之後的存檔不再自動寫 char_updated——不再自動追蹤「更新了角色卡」', async () => {
    await char.patchChar(db, slug, charId, { name: '測試角色' }); // 第一次，轉 active
    await char.patchChar(db, slug, charId, { one_liner: '改了一句話介紹' }); // 第二次
    const updated = await eventsFor('char_updated');
    expect(updated).toHaveLength(0);
  });
});

describe('shareCharUpdate（1-3 存檔後才問的分享）', () => {
  it('有內容才寫 char_updated，內容放進 payload.note', async () => {
    await char.patchChar(db, slug, charId, { name: '測試角色' }); // 先轉 active
    const r = await char.shareCharUpdate(db, slug, charId, '補了背景故事');
    expect('ok' in r).toBe(true);
    const updated = await eventsFor('char_updated');
    expect(updated).toHaveLength(1);
    expect((updated[0].payload as { note?: string }).note).toBe('補了背景故事');
  });

  it('空字串（或只有空白）拒絕，不寫事件', async () => {
    await char.patchChar(db, slug, charId, { name: '測試角色' });
    const r = await char.shareCharUpdate(db, slug, charId, '   ');
    expect('error' in r).toBe(true);
    const updated = await eventsFor('char_updated');
    expect(updated).toHaveLength(0);
  });
});

describe('joinProject 加入當下就是最終狀態（Ticket-11，取代原本的 draft→首次儲存才 active）', () => {
  it('加入當下 status 就是 active，不用等第一次存檔', async () => {
    const joined = await char.joinProject(db, slug, `d_${crypto.randomUUID().slice(0, 8)}`, { name: '新加入角色' });
    if (!('ok' in joined)) throw new Error('joinProject failed');
    expect(joined.character.status).toBe('active');
  });

  it('加入當下就寫一筆 char_joined 動態，不用等 patchChar', async () => {
    const before = await eventsFor('char_joined');
    await char.joinProject(db, slug, `d_${crypto.randomUUID().slice(0, 8)}`, { name: '新加入角色2' });
    const after = await eventsFor('char_joined');
    expect(after.length).toBe(before.length + 1);
  });

  it('加入當下就出現在公開名單（listChars 只回 active）', async () => {
    const joined = await char.joinProject(db, slug, `d_${crypto.randomUUID().slice(0, 8)}`, { name: '新加入角色3' });
    if (!('ok' in joined)) throw new Error('joinProject failed');
    const rows = await char.listChars(db, projectId);
    expect(rows.some((c) => c.id === joined.character.id)).toBe(true);
  });
});

describe('joinProject 角色數量上限（同一 discord_id 最多 20 隻）', () => {
  it('第 21 隻角色被拒絕，前 20 隻不受影響', async () => {
    const discordId = `d_${crypto.randomUUID().slice(0, 8)}`;
    for (let i = 0; i < 20; i++) {
      const r = await char.joinProject(db, slug, discordId, { name: `角色${i}` });
      expect('ok' in r).toBe(true);
    }
    const r21 = await char.joinProject(db, slug, discordId, { name: '角色21' });
    expect('error' in r21).toBe(true);
  });

  it('不同 discord_id 各自獨立計算上限', async () => {
    const a = `d_${crypto.randomUUID().slice(0, 8)}`;
    const b = `d_${crypto.randomUUID().slice(0, 8)}`;
    for (let i = 0; i < 20; i++) {
      await char.joinProject(db, slug, a, { name: `A${i}` });
    }
    const rb = await char.joinProject(db, slug, b, { name: 'B的角色' });
    expect('ok' in rb).toBe(true);
  });
});
