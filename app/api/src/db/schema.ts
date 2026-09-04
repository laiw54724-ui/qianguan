// Drizzle schema — 唯一真相來源（規格 §3.1）
// 備註：world_blocks / qa / icon_url / characters.blocks 是原型已上線的
// 擴充欄位（JSON TEXT），規格 §3.1 最小欄位集之外的「做了沒寫」部分，在此補齊。
// relations.extras 已在 1.5-1 拿掉，換成 relation_notes 表。
import { sqliteTable, text, integer, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(), // prj_xxxxxxxx
  slug: text('slug').notNull().unique(), // 網址用，可讀
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  worldNote: text('world_note').notNull().default(''), // 舊版純文字世界觀（備援）
  worldBlocks: text('world_blocks', { mode: 'json' }).$defaultFn(() => []), // JSON: WorldBlock[]
  qa: text('qa', { mode: 'json' }).$defaultFn(() => []), // JSON: QaItem[]
  coverUrl: text('cover_url'),
  iconUrl: text('icon_url'),
  visibility: text('visibility').notNull().default('unlisted'), // public|unlisted
  joinMode: text('join_mode').notNull().default('open'), // open|code
  joinCodeHash: text('join_code_hash'),
  signupsOpen: integer('signups_open', { mode: 'boolean' }).notNull().default(true),
  ownerTokenHash: text('owner_token_hash').notNull(),
  ownerDiscordId: text('owner_discord_id'), // §4.4 預留
  transferCodeHash: text('transfer_code_hash'), // §8 預留
  isVerified: integer('is_verified', { mode: 'boolean' }).notNull().default(false),
  announcement: text('announcement'),
  fieldSchema: text('field_schema', { mode: 'json' }).$defaultFn(() => []), // JSON: FieldDef[]
  tagGroups: text('tag_groups', { mode: 'json' }).$defaultFn(() => []), // JSON: TagGroup[]
  links: text('links', { mode: 'json' }).$defaultFn(() => []), // JSON: SocialLink[]
  rev: integer('rev').notNull().default(1), // §7 快取版本號預留
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const characters = sqliteTable(
  'characters',
  {
    id: text('id').primaryKey(), // 公開短碼 XXXX-XXXX（CSPRNG，規格 §4.1）
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    oneLiner: text('one_liner').notNull().default(''),
    avatarUrl: text('avatar_url'),
    profile: text('profile', { mode: 'json' }).$defaultFn(() => ({})), // JSON：彈性欄位，不要 EAV
    blocks: text('blocks', { mode: 'json' }).$defaultFn(() => []), // JSON: WorldBlock[]
    links: text('links', { mode: 'json' }).$defaultFn(() => []), // JSON: SocialLink[]
    tags: text('tags', { mode: 'json' }).$defaultFn(() => []), // JSON: string[]
    editTokenHash: text('edit_token_hash').notNull(),
    discordId: text('discord_id'), // §4.4 預留
    status: text('status').notNull().default('active'), // active|draft|removed（draft＝完成前不公開，§12）
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_char_project').on(t.projectId, t.status), index('idx_char_discord').on(t.discordId)],
);

export const relations = sqliteTable(
  'relations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    // 正規化：a_id < b_id（字串比較），確保同一對角色只有一列
    aId: text('a_id')
      .notNull()
      .references(() => characters.id),
    bId: text('b_id')
      .notNull()
      .references(() => characters.id),
    aLabel: text('a_label').notNull().default(''),
    aNote: text('a_note').notNull().default(''),
    bLabel: text('b_label').notNull().default(''),
    bNote: text('b_note').notNull().default(''),
    status: text('status').notNull().default('pending'), // pending|accepted|declined
    initiator: text('initiator').notNull(), // 'a'|'b'
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('idx_rel_pair').on(t.aId, t.bId),
    index('idx_rel_project').on(t.projectId, t.status),
    index('idx_rel_b').on(t.bId),
    check('chk_rel_order', sql`${t.aId} < ${t.bId}`),
  ],
);

export const relationNotes = sqliteTable(
  'relation_notes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    relationId: integer('relation_id')
      .notNull()
      .references(() => relations.id),
    body: text('body').notNull(),
    authorSide: text('author_side').notNull(), // 'a'|'b'
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_rnotes').on(t.relationId, t.createdAt)],
);

export const privateRelations = sqliteTable(
  'private_relations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    ownerCharId: text('owner_char_id')
      .notNull()
      .references(() => characters.id),
    ghostName: text('ghost_name').notNull(),
    label: text('label').notNull().default(''),
    note: text('note').notNull().default(''),
    linkedCharId: text('linked_char_id').references(() => characters.id),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_priv').on(t.ownerCharId)],
);

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    type: text('type').notNull(), // char_joined|char_updated|relation_accepted|announcement
    actorId: text('actor_id'),
    targetId: text('target_id'),
    payload: text('payload', { mode: 'json' }).$defaultFn(() => ({})),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_event_feed').on(t.projectId, t.createdAt)],
);

export type ProjectRow = typeof projects.$inferSelect;
export type CharacterRow = typeof characters.$inferSelect;
export type RelationRow = typeof relations.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type RelationNoteRow = typeof relationNotes.$inferSelect;
export type PrivateRelationRow = typeof privateRelations.$inferSelect;
