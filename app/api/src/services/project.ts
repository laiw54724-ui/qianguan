// services/project.ts — 移植 web/src/lib/store.ts 的專案相關函式。
// 規則：邏輯照抄；localStorage 換 Drizzle；不輸出任何 *_hash 欄位。

import { and, eq, ne, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { characters, events, projects, relations, type ProjectRow } from '../db/schema';
import { AUTH_FAIL, genSlug, genToken, normJoinCode, sha256hex } from '../auth/token';
import { resolveToken, ownerCookieLine } from '../auth/guard';
import { fromJson, sanitizeLinks, sanitizeTagGroups, type FieldDef, type WorldBlock } from './shapes';
import { toChar } from './character';

type DB = DrizzleD1Database;

// ---- 讀取 ----

export async function getProjectRaw(db: DB, slug: string): Promise<ProjectRow | undefined> {
  const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  return rows[0];
}

// 輸出前剝掉雜湊。join_code_hash 只回「有沒有」（has_join_code），owner_token_hash 永遠不出門。
export function toProject(p: ProjectRow) {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    summary: p.summary,
    world_note: p.worldNote,
    world_blocks: fromJson<WorldBlock[]>(p.worldBlocks, []),
    qa: fromJson<{ id: string; q: string; a: string }[]>(p.qa, []),
    cover_url: p.coverUrl,
    icon_url: p.iconUrl,
    visibility: p.visibility,
    join_mode: p.joinMode,
    has_join_code: !!p.joinCodeHash,
    signups_open: !!p.signupsOpen,
    is_verified: !!p.isVerified,
    announcement: p.announcement,
    field_schema: fromJson<FieldDef[]>(p.fieldSchema, []),
    tag_groups: sanitizeTagGroups(fromJson(p.tagGroups, [])),
    links: sanitizeLinks(fromJson(p.links, [])),
    rev: p.rev,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

// ---- 建立（單筆寫入；join_code 立即雜湊，§12 不再有發布時才雜湊）----

export async function genSlugUnique(db: DB): Promise<string> {
  for (let i = 0; i < 32; i++) {
    const s = genSlug();
    const rows = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, s)).limit(1);
    if (!rows[0]) return s;
  }
  return genSlug() + genSlug();
}

const DEFAULT_FIELDS: FieldDef[] = [
  { key: 'nick', label: '暱稱', type: 'text' },
  { key: 'age', label: '年齡', type: 'text' },
  { key: 'role', label: '職業／身份', type: 'text' },
];

export async function createProject(
  db: DB,
  input: {
    title: string; summary: string; cover_url?: string; icon_url?: string;
    visibility?: string; join_mode: string; join_code?: string;
    links?: unknown;
  },
) {
  const slug = await genSlugUnique(db);
  const now = Date.now();
  const ownerToken = genToken('own');
  const transferCode = genToken('inv');
  const id = `prj_${genSlug()}`;
  await db.insert(projects).values({
    id,
    slug,
    title: input.title.trim(),
    summary: input.summary.trim(),
    coverUrl: input.cover_url || null,
    iconUrl: input.icon_url || null,
    visibility: input.visibility === 'public' ? 'public' : 'unlisted',
    joinMode: input.join_mode === 'code' ? 'code' : 'open',
    joinCodeHash: input.join_code ? await sha256hex(normJoinCode(input.join_code)) : null,
    ownerTokenHash: await sha256hex(ownerToken),
    transferCodeHash: await sha256hex(transferCode),
    fieldSchema: DEFAULT_FIELDS,
    tagGroups: [],
    links: sanitizeLinks(input.links),
    createdAt: now,
    updatedAt: now,
  });
  const row = (await getProjectRaw(db, slug))!;
  return {
    project: toProject(row),
    ownerToken,
    transferCode,
    cookie: ownerCookieLine(slug, id, ownerToken),
  };
}

// ---- 列表 ----

export async function findSimilarProjects(db: DB, title: string) {
  const n = title.trim().toLowerCase();
  if (!n) return [];
  const rows = await db.select().from(projects).where(eq(projects.visibility, 'public')).limit(100);
  return rows.filter((p) => p.title.toLowerCase().includes(n)).slice(0, 8).map(toProject);
}

export async function listPublicProjects(db: DB) {
  const rows = await db.select().from(projects).where(eq(projects.visibility, 'public')).limit(100);
  return rows
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toProject);
}

// ---- 權杖驗證（統一失敗訊息 AUTH_FAIL，不洩漏是哪一邊錯）----

export async function verifyOwner(
  db: DB,
  slug: string,
  cookieHeader: string | undefined,
  bodyToken: string,
): Promise<{ project: ReturnType<typeof toProject>; cookie?: string } | null> {
  const p = await getProjectRaw(db, slug);
  if (!p) return null;
  const r = await resolveToken(cookieHeader, p.id, 'o', bodyToken, p.ownerTokenHash);
  if (!r.ok) return null;
  return {
    project: toProject(p),
    cookie: r.plant ? ownerCookieLine(slug, p.id, bodyToken.trim()) : undefined,
  };
}

// ---- 更新（公告變更＝多筆寫入，batch）----

export async function patchProject(
  db: DB,
  slug: string,
  patch: {
    title?: string; summary?: string; world_note?: string; world_blocks?: WorldBlock[];
    qa?: { id: string; q: string; a: string }[]; cover_url?: string; icon_url?: string;
    visibility?: string; join_mode?: string; signups_open?: boolean; join_code?: string;
    announcement?: string; field_schema?: FieldDef[]; expected_rev?: number;
    tag_groups?: unknown; links?: unknown;
  },
): Promise<{ ok: true; updated_at: number; rev: number } | { error: string; conflict?: true }> {
  const p = await getProjectRaw(db, slug);
  if (!p) return { error: AUTH_FAIL };
  // §7 樂觀鎖：有帶 expected_rev 才檢查（舊呼叫端不帶＝維持原本直接覆蓋行為）
  if (patch.expected_rev !== undefined && patch.expected_rev !== p.rev) {
    return { error: '有其他人已經更新過這個企劃，請重新整理再試一次', conflict: true };
  }
  const now = Date.now();
  const set: Record<string, unknown> = { updatedAt: now, rev: sql`${projects.rev} + 1` };
  if (patch.title !== undefined) set.title = patch.title.trim();
  if (patch.summary !== undefined) set.summary = patch.summary;
  if (patch.world_note !== undefined) set.worldNote = patch.world_note;
  if (patch.world_blocks !== undefined) set.worldBlocks = patch.world_blocks;
  if (patch.qa !== undefined) set.qa = patch.qa;
  if (patch.cover_url !== undefined) set.coverUrl = patch.cover_url || null;
  if (patch.icon_url !== undefined) set.iconUrl = patch.icon_url || null;
  if (patch.visibility !== undefined) set.visibility = patch.visibility === 'public' ? 'public' : 'unlisted';
  if (patch.join_mode !== undefined) set.joinMode = patch.join_mode === 'code' ? 'code' : 'open';
  if (patch.signups_open !== undefined) set.signupsOpen = !!patch.signups_open;
  if (patch.announcement !== undefined) set.announcement = patch.announcement || null;
  if (patch.field_schema !== undefined) set.fieldSchema = patch.field_schema;
  if (patch.tag_groups !== undefined) set.tagGroups = sanitizeTagGroups(patch.tag_groups);
  if (patch.links !== undefined) set.links = sanitizeLinks(patch.links);
  if (patch.join_code !== undefined) {
    set.joinCodeHash = patch.join_code ? await sha256hex(normJoinCode(patch.join_code)) : null;
  }

  const newAnnouncement = patch.announcement?.trim();
  const announcementChanged =
    patch.announcement !== undefined && newAnnouncement && newAnnouncement !== (p.announcement ?? '');

  const updateStmt = db.update(projects).set(set).where(eq(projects.id, p.id)).returning();
  if (announcementChanged) {
    await db.batch([
      updateStmt,
      db.insert(events).values({
        projectId: p.id,
        type: 'announcement',
        actorId: null,
        targetId: null,
        payload: { text: newAnnouncement },
        createdAt: now,
      }).returning(),
    ]);
  } else {
    await updateStmt;
  }
  return { ok: true, updated_at: now, rev: p.rev + 1 };
}

// ---- 名冊 / 統計（Manage 頁）----

export interface RosterRow {
  character: ReturnType<typeof toChar>;
  unfilled: number;
  relationCount: number;
}

export async function roster(db: DB, slug: string): Promise<RosterRow[]> {
  const p = await getProjectRaw(db, slug);
  if (!p) return [];
  const chars = await db.select().from(characters)
    .where(and(eq(characters.projectId, p.id), ne(characters.status, 'removed')));
  const rels = await db.select().from(relations)
    .where(and(eq(relations.projectId, p.id), eq(relations.status, 'accepted')));
  const schema = fromJson<FieldDef[]>(p.fieldSchema, []);
  return chars
    .map((c) => {
      const profile = fromJson<Record<string, string>>(c.profile, {});
      const unfilled = schema.filter((f) => !(profile[f.key] ?? '').trim()).length;
      const relationCount = rels.filter((r) => r.aId === c.id || r.bId === c.id).length;
      return { character: toChar(c), unfilled, relationCount };
    })
    .sort((a, b) => a.character.name.localeCompare(b.character.name, 'zh-Hant'));
}

export async function stats(db: DB, slug: string) {
  const p = await getProjectRaw(db, slug);
  if (!p) return { members: 0, pending_relations: 0, accepted_relations: 0 };
  const [{ n: members }] = await db.select({ n: sql<number>`count(*)` }).from(characters)
    .where(and(eq(characters.projectId, p.id), eq(characters.status, 'active')));
  const [{ n: accepted_relations }] = await db.select({ n: sql<number>`count(*)` }).from(relations)
    .where(and(eq(relations.projectId, p.id), eq(relations.status, 'accepted')));
  const [{ n: pending_relations }] = await db.select({ n: sql<number>`count(*)` }).from(relations)
    .where(and(eq(relations.projectId, p.id), eq(relations.status, 'pending')));
  return { members, pending_relations, accepted_relations };
}
