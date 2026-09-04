// services/session.test.ts
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, expect, it } from 'vitest';
import * as sessionSvc from './session';

const db = drizzle(env.DB);

describe('createSession / resolveSession', () => {
  it('建立 session 後，帶著發回的 cookie 能解析回同一個 discord_id', async () => {
    const discordId = `d_${crypto.randomUUID().slice(0, 8)}`;
    const { cookie } = await sessionSvc.createSession(db, discordId);
    const token = cookie.split(';')[0].split('=')[1];
    const resolved = await sessionSvc.resolveSession(db, `kg_session=${token}`);
    expect(resolved?.discordId).toBe(discordId);
  });

  it('沒有 cookie 時回傳 null', async () => {
    expect(await sessionSvc.resolveSession(db, undefined)).toBeNull();
  });

  it('偽造的 token 解析不出任何身分', async () => {
    expect(await sessionSvc.resolveSession(db, 'kg_session=ses_bogus')).toBeNull();
  });
});

describe('revokeCurrentSession', () => {
  it('撤銷後同一條 cookie 不再解析得出身分', async () => {
    const discordId = `d_${crypto.randomUUID().slice(0, 8)}`;
    const { cookie } = await sessionSvc.createSession(db, discordId);
    const token = cookie.split(';')[0].split('=')[1];
    const header = `kg_session=${token}`;
    await sessionSvc.revokeCurrentSession(db, header);
    expect(await sessionSvc.resolveSession(db, header)).toBeNull();
  });

  it('沒有 cookie 時不拋錯', async () => {
    await expect(sessionSvc.revokeCurrentSession(db, undefined)).resolves.toBeUndefined();
  });
});

describe('revokeAllSessions', () => {
  it('撤銷這個 discord_id 底下所有 session，其他人的不受影響', async () => {
    const a = `d_${crypto.randomUUID().slice(0, 8)}`;
    const b = `d_${crypto.randomUUID().slice(0, 8)}`;
    const s1 = await sessionSvc.createSession(db, a);
    const s2 = await sessionSvc.createSession(db, a);
    const s3 = await sessionSvc.createSession(db, b);
    await sessionSvc.revokeAllSessions(db, a);
    const t1 = s1.cookie.split(';')[0].split('=')[1];
    const t2 = s2.cookie.split(';')[0].split('=')[1];
    const t3 = s3.cookie.split(';')[0].split('=')[1];
    expect(await sessionSvc.resolveSession(db, `kg_session=${t1}`)).toBeNull();
    expect(await sessionSvc.resolveSession(db, `kg_session=${t2}`)).toBeNull();
    expect((await sessionSvc.resolveSession(db, `kg_session=${t3}`))?.discordId).toBe(b);
  });
});
