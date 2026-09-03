// services/character.ts — 移植 store.ts 的角色相關函式。
// 角色的 id 就是公開短碼 XXXX-XXXX（CSPRNG，§4.1）。
// §12：新建角色 status='draft'，首次儲存才轉 active 並寫 char_joined 動態。
// 多筆寫入（首次儲存啟用＋動態、更新＋動態）一律 db.batch()，同一個交易。

import { and, eq, ne } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { characters, events, type CharacterRow } from '../db/schema';
import { AUTH_FAIL, genPublicId, genToken, normJoinCode, sha256hex } from '../auth/token';
import { charCookieLine, charCookieLineRotate, charTokens, resolveToken } from '../auth/guard';
import { getProjectRaw } from './project';
import { fromJson, sanitizeLinks, sanitizeTags, type WorldBlock } from './shapes';

type DB = DrizzleD1Database;

export function toChar(c: CharacterRow) {
  return {
    id: c.id, // 公開短碼
    project_id: c.projectId,
    name: c.name,
    one_liner: c.oneLiner,
    avatar_url: c.avatarUrl,
    profile: fromJson<Record<string, string>>(c.profile, {}),
    blocks: fromJson<WorldBlock[]>(c.blocks, []),
    links: sanitizeLinks(fromJson(c.links, [])),
    tags: sanitizeTags(fromJson(c.tags, [])),
    status: c.status,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

async function genCharIdUnique(db: DB): Promise<string> {
  for (let i = 0; i < 32; i++) {
    const id = genPublicId();
    const rows = await db.select({ id: characters.id }).from(characters).where(eq(characters.id, id)).limit(1);
    if (!rows[0]) return id;
  }
  return genPublicId();
}

export async function getCharRaw(db: DB, projectId: string, charId: string) {
  const rows = await db.select().from(characters)
    .where(and(eq(characters.projectId, projectId), eq(characters.id, charId), ne(characters.status, 'removed')))
    .limit(1);
  return rows[0];
}

export async function getChar(db: DB, slug: string, charId: string) {
  const p = await getProjectRaw(db, slug);
  if (!p) return null;
  const c = await getCharRaw(db, p.id, charId);
  if (!c) return null;
  return { project: p, character: c };
}

// ---- 加入企劃（建 draft 角色；首次儲存才公開）----

export async function joinProject(
  db: DB,
  slug: string,
  cookieHeader: string | undefined,
  input: {
    name: string; one_liner?: string; avatar_url?: string;
    profile?: Record<string, string>; blocks?: WorldBlock[]; join_code?: string;
    links?: unknown; tags?: unknown;
  },
): Promise<{ ok: true; character: ReturnType<typeof toChar>; charToken: string; cookie: string } | { error: string }> {
  const p = await getProjectRaw(db, slug);
  if (!p) return { error: AUTH_FAIL };
  if (!p.signupsOpen) return { error: '這個企劃目前沒有開放加入' };
  if (p.joinMode === 'code') {
    const code = normJoinCode(input.join_code ?? '');
    if (!code || (await sha256hex(code)) !== p.joinCodeHash) return { error: '加入密語不正確' };
  }
  const name = input.name.trim();
  if (!name) return { error: '名字不能留空' };

  const charToken = genToken('chr');
  const id = await genCharIdUnique(db);
  const now = Date.now();
  await db.insert(characters).values({
    id,
    projectId: p.id,
    name,
    oneLiner: (input.one_liner ?? '').trim(),
    avatarUrl: input.avatar_url || null,
    profile: input.profile ?? {},
    blocks: input.blocks ?? [],
    links: sanitizeLinks(input.links),
    tags: sanitizeTags(input.tags),
    status: 'draft',
    editTokenHash: await sha256hex(charToken),
    createdAt: now,
    updatedAt: now,
  });
  const c = (await getCharRaw(db, p.id, id))!;
  return {
    ok: true,
    character: toChar(c),
    charToken,
    cookie: charCookieLine(slug, p.id, cookieHeader, charToken),
  };
}

// ---- 讀取 ----

export async function listChars(db: DB, projectId: string) {
  const rows = await db.select().from(characters)
    .where(and(eq(characters.projectId, projectId), eq(characters.status, 'active')));
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')).map(toChar);
}

// ---- 權杖驗證 ----

export async function verifyCharToken(
  db: DB,
  slug: string,
  charId: string,
  cookieHeader: string | undefined,
  bodyToken: string,
): Promise<{ character: ReturnType<typeof toChar>; cookie?: string } | null> {
  const got = await getChar(db, slug, charId);
  if (!got) return null;
  const r = await resolveToken(cookieHeader, got.project.id, 'c', bodyToken, got.character.editTokenHash);
  if (!r.ok) return null;
  return {
    character: toChar(got.character),
    cookie: r.plant ? charCookieLine(slug, got.project.id, cookieHeader, bodyToken.trim()) : undefined,
  };
}

// ---- 更新（首次儲存＝啟用＋char_joined；之後＝char_updated；都要 batch）----

export async function patchChar(
  db: DB,
  slug: string,
  charId: string,
  patch: {
    name?: string; one_liner?: string; avatar_url?: string;
    profile?: Record<string, string>; blocks?: WorldBlock[];
    links?: unknown; tags?: unknown;
  },
): Promise<{ ok: true; updated_at: number } | { error: string }> {
  const got = await getChar(db, slug, charId);
  if (!got) return { error: AUTH_FAIL };
  const { project: p, character: c } = got;
  const now = Date.now();

  const set: Record<string, unknown> = { updatedAt: now };
  if (patch.name !== undefined) set.name = patch.name.trim() || c.name;
  if (patch.one_liner !== undefined) set.oneLiner = patch.one_liner;
  if (patch.avatar_url !== undefined) set.avatarUrl = patch.avatar_url || null;
  if (patch.profile !== undefined) set.profile = patch.profile;
  if (patch.blocks !== undefined) set.blocks = patch.blocks;
  if (patch.links !== undefined) set.links = sanitizeLinks(patch.links);
  if (patch.tags !== undefined) set.tags = sanitizeTags(patch.tags);

  const activating = c.status === 'draft';
  if (activating) set.status = 'active';
  const name = (set.name as string) ?? c.name;

  // 1-3：加入是公開行為，char_joined 照舊自動發；「更新了角色卡」不再自動發——
  // 有些人不想被自動追蹤動態。要分享用獨立的 shareCharUpdate()（存檔後才問，
  // 使用者自己決定要不要送），單純存檔不再順便產生動態。
  const updateStmt = db.update(characters).set(set).where(eq(characters.id, c.id)).returning();
  if (activating) {
    await db.batch([
      updateStmt,
      db.insert(events).values({
        projectId: p.id, type: 'char_joined', actorId: c.id, targetId: null,
        payload: { name }, createdAt: now,
      }).returning(),
    ]);
  } else {
    await updateStmt;
  }
  return { ok: true, updated_at: now };
}

// ---- 1-3：存檔後才問的「要不要跟大家說一聲？」——獨立端點，只發事件，
// 不重送整張角色卡（存檔那次早就送過了，這裡只差一句話要不要公開）----

export async function shareCharUpdate(
  db: DB,
  slug: string,
  charId: string,
  note: string,
): Promise<{ ok: true } | { error: string }> {
  const trimmed = note.trim();
  if (!trimmed) return { error: '請填一句話再分享' };
  const got = await getChar(db, slug, charId);
  if (!got) return { error: AUTH_FAIL };
  const { project: p, character: c } = got;
  await db.insert(events).values({
    projectId: p.id, type: 'char_updated', actorId: c.id, targetId: null,
    payload: { name: c.name, note: trimmed.slice(0, 140) }, createdAt: Date.now(),
  });
  return { ok: true };
}

// ---- 1-4：重看編輯碼（重新產生一組新的，不是找回原本那組——原始權杖只存雜湊，
// 拿不回來；但使用者當下就在自己的角色頁，等於已經驗過身分，直接發一組新的
// 讓他重新抄一次，跟貼碼救援達到同樣效果，體感更順）----

export async function rotateCharToken(
  db: DB,
  slug: string,
  charId: string,
  cookieHeader: string | undefined,
): Promise<{ character: ReturnType<typeof toChar>; charToken: string; cookie: string } | { error: string }> {
  const got = await getChar(db, slug, charId);
  if (!got) return { error: AUTH_FAIL };
  const { project: p, character: c } = got;
  let oldToken: string | null = null;
  for (const t of charTokens(cookieHeader, p.id)) {
    if ((await sha256hex(t)) === c.editTokenHash) { oldToken = t; break; }
  }
  if (!oldToken) return { error: AUTH_FAIL };

  const newToken = genToken('chr');
  const now = Date.now();
  await db.update(characters).set({ editTokenHash: await sha256hex(newToken), updatedAt: now })
    .where(eq(characters.id, c.id));
  const updated = (await getCharRaw(db, p.id, c.id))!;
  return {
    character: toChar(updated),
    charToken: newToken,
    cookie: charCookieLineRotate(slug, p.id, cookieHeader, oldToken, newToken),
  };
}

// ---- 移除（soft-delete，§6.8；開設者操作，權杖在路由層驗）----

export async function removeChar(db: DB, slug: string, charId: string): Promise<{ ok: true } | { error: string }> {
  const got = await getChar(db, slug, charId);
  if (!got) return { error: AUTH_FAIL };
  await db.update(characters).set({ status: 'removed', updatedAt: Date.now() })
    .where(eq(characters.id, got.character.id));
  return { ok: true };
}

// ---- 為已有角色的人再開一隻空白 OC（Relations 頁「新增角色」）----
// 需已持有本企劃任一角色權杖（路由層驗）；新權杖併入既有 cookie，不覆寫。

export async function createDraftChar(
  db: DB,
  slug: string,
  cookieHeader: string | undefined,
  name: string,
): Promise<{ ok: true; character: ReturnType<typeof toChar>; charToken: string; cookie: string } | { error: string }> {
  const p = await getProjectRaw(db, slug);
  if (!p) return { error: AUTH_FAIL };
  const trimmed = name.trim();
  if (!trimmed) return { error: '名字不能留空' };
  const charToken = genToken('chr');
  const id = await genCharIdUnique(db);
  const now = Date.now();
  await db.insert(characters).values({
    id,
    projectId: p.id,
    name: trimmed,
    status: 'draft',
    editTokenHash: await sha256hex(charToken),
    createdAt: now,
    updatedAt: now,
  });
  const c = (await getCharRaw(db, p.id, id))!;
  return {
    ok: true,
    character: toChar(c),
    charToken,
    cookie: charCookieLine(slug, p.id, cookieHeader, charToken),
  };
}
