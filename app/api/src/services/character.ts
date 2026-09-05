// services/character.ts — 移植 store.ts 的角色相關函式。
// 角色的 id 就是公開短碼 XXXX-XXXX（CSPRNG，§4.1）。
// Ticket-11：加入當下就是最終狀態——status='active'，立刻寫 char_joined 動態、立刻出現在
// 名單。原本 §12 的「新建角色 status='draft'，首次儲存才轉 active」設計已經拿掉；
// `status` 欄位仍保留 'draft' 這個值只是為了相容任何舊資料，新建流程不會再產生它。
// 多筆寫入（加入＋動態、更新＋動態）一律 db.batch()，同一個交易。

import { and, eq, ne } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { characters, events, type CharacterRow } from '../db/schema';
import { AUTH_FAIL, genPublicId, normJoinCode, sha256hex } from '../auth/token';
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

// ---- 加入企劃（Ticket-11：加入當下就是最終狀態，立刻公開）----

const MAX_CHARS_PER_OWNER = 20;

export async function joinProject(
  db: DB,
  slug: string,
  discordId: string,
  input: {
    name: string; one_liner?: string; avatar_url?: string;
    profile?: Record<string, string>; blocks?: WorldBlock[]; join_code?: string;
    links?: unknown; tags?: unknown;
  },
): Promise<{ ok: true; character: ReturnType<typeof toChar> } | { error: string }> {
  const p = await getProjectRaw(db, slug);
  if (!p) return { error: AUTH_FAIL };
  if (!p.signupsOpen) return { error: '這個企劃目前沒有開放加入' };
  if (p.joinMode === 'code') {
    const code = normJoinCode(input.join_code ?? '');
    if (!code || (await sha256hex(code)) !== p.joinCodeHash) return { error: '加入密語不正確' };
  }
  const name = input.name.trim();
  if (!name) return { error: '名字不能留空' };

  const existing = await db.select({ id: characters.id }).from(characters)
    .where(and(eq(characters.projectId, p.id), eq(characters.discordId, discordId), ne(characters.status, 'removed')));
  if (existing.length >= MAX_CHARS_PER_OWNER) return { error: `這個企劃裡最多只能開 ${MAX_CHARS_PER_OWNER} 隻角色` };

  const id = await genCharIdUnique(db);
  const now = Date.now();
  await db.batch([
    db.insert(characters).values({
      id,
      projectId: p.id,
      name,
      oneLiner: (input.one_liner ?? '').trim(),
      avatarUrl: input.avatar_url || null,
      profile: input.profile ?? {},
      blocks: input.blocks ?? [],
      links: sanitizeLinks(input.links),
      tags: sanitizeTags(input.tags),
      status: 'active',
      discordId,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(events).values({
      projectId: p.id, type: 'char_joined', actorId: id, targetId: null,
      payload: { name }, createdAt: now,
    }),
  ]);
  const c = (await getCharRaw(db, p.id, id))!;
  return { ok: true, character: toChar(c) };
}

// ---- 讀取 ----

export async function listChars(db: DB, projectId: string) {
  const rows = await db.select().from(characters)
    .where(and(eq(characters.projectId, projectId), eq(characters.status, 'active')));
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')).map(toChar);
}

// ---- 更新（Ticket-11 之後 joinProject() 已經直接是 active，這裡的 draft→active
// 轉換只是保留給任何舊資料相容，新建角色不會再走到這個分支；都要 batch）----

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

// ---- 移除（soft-delete，§6.8；開設者操作，權杖在路由層驗）----

export async function removeChar(db: DB, slug: string, charId: string): Promise<{ ok: true } | { error: string }> {
  const got = await getChar(db, slug, charId);
  if (!got) return { error: AUTH_FAIL };
  await db.update(characters).set({ status: 'removed', updatedAt: Date.now() })
    .where(eq(characters.id, got.character.id));
  return { ok: true };
}

