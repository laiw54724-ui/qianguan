// character.ts 的兩塊新邏輯的回歸測試：
// 1-3 動態牆改主動發布——patchChar 只在 share_note 非空時才寫 char_updated 事件。
// 1-4 重看編輯碼——rotateCharToken 換發新權杖、舊權杖同時失效。
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
let charToken: string;
let cookieHeader: string;

beforeEach(async () => {
  projectId = `prj_test_${crypto.randomUUID().slice(0, 8)}`;
  slug = `slug-${projectId}`;
  const now = Date.now();
  await db.insert(projects).values({
    id: projectId, slug, title: '測試企劃', ownerTokenHash: 'x', createdAt: now, updatedAt: now,
  });

  const joined = await char.joinProject(db, slug, undefined, { name: '測試角色' });
  if (!('ok' in joined)) throw new Error('setup: joinProject failed');
  charId = joined.character.id;
  charToken = joined.charToken;
  cookieHeader = `kg_c_${projectId}=${charToken}`;
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

describe('rotateCharToken（1-4 重看編輯碼）', () => {
  it('換發新權杖後，舊權杖不能再用，新權杖可以', async () => {
    const r = await char.rotateCharToken(db, slug, charId, cookieHeader);
    expect('charToken' in r).toBe(true);
    if (!('charToken' in r)) return;

    const withOld = await char.verifyCharToken(db, slug, charId, undefined, charToken);
    expect(withOld).toBeNull();

    const withNew = await char.verifyCharToken(db, slug, charId, undefined, r.charToken);
    expect(withNew).not.toBeNull();
  });

  it('新 cookie 換掉舊 token，不是疊加——同一個角色不會留下兩個同時有效的權杖', async () => {
    const r = await char.rotateCharToken(db, slug, charId, cookieHeader);
    if (!('cookie' in r)) throw new Error('rotate failed');
    expect(r.cookie).toContain(r.charToken);
    expect(r.cookie).not.toContain(charToken);
  });

  it('cookie 裡沒有這隻角色有效權杖時拒絕（不能憑空重發）', async () => {
    const r = await char.rotateCharToken(db, slug, charId, `kg_c_${projectId}=chr_wrongtoken00000000000000000`);
    expect('error' in r).toBe(true);
  });
});
