// services/session.ts — Discord session 存取層。
import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { sessions } from '../db/schema';
import { genToken, sha256hex } from '../auth/token';
import { readCookieFrom, sessionCookieLine, SESSION_COOKIE } from '../auth/guard';

type DB = DrizzleD1Database;

export const SESSION_MAX_AGE_MS = 15552000_000; // 180 天，跟 cookie 的 Max-Age（秒）算同一段時間

export async function createSession(db: DB, discordId: string): Promise<{ discordId: string; cookie: string }> {
  const token = genToken('ses');
  const now = Date.now();
  await db.insert(sessions).values({
    tokenHash: await sha256hex(token),
    discordId,
    createdAt: now,
    expiresAt: now + SESSION_MAX_AGE_MS,
  });
  return { discordId, cookie: sessionCookieLine(token) };
}

export async function resolveSession(db: DB, cookieHeader: string | undefined): Promise<{ discordId: string } | null> {
  const token = readCookieFrom(cookieHeader, SESSION_COOKIE);
  if (!token) return null;
  const hash = await sha256hex(token);
  const rows = await db.select().from(sessions).where(eq(sessions.tokenHash, hash)).limit(1);
  const row = rows[0];
  if (!row || row.expiresAt <= Date.now()) return null;
  return { discordId: row.discordId };
}

/** 撤銷這條 cookie 目前指到的 session（不存在就當作沒事）——登入/登出都呼叫這個，不分支。 */
export async function revokeCurrentSession(db: DB, cookieHeader: string | undefined): Promise<void> {
  const token = readCookieFrom(cookieHeader, SESSION_COOKIE);
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, await sha256hex(token)));
}

export async function revokeAllSessions(db: DB, discordId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.discordId, discordId));
}
