// schemas.ts — 路由層的 zod 參數驗證。路由只做「驗參數 → 呼叫 service → 回傳」。
// 區塊欄位（BlockField）型別多達 20 種且還在長，深層結構從寬驗，只鎖外殼與長度上限。

import { z } from 'zod';

const str = (max: number) => z.string().max(max);
const optStr = (max: number) => z.string().max(max).optional();

const blockField = z.looseObject({
  id: str(64),
  label: str(200),
  type: str(32),
  content: str(900_000),
  images: z.array(str(900_000)).max(30).optional(),
  options: z.array(str(200)).max(50).optional(),
});
const worldBlock = z.looseObject({
  id: str(64),
  title: str(200),
  fields: z.array(blockField).max(100),
});
const qaItem = z.looseObject({ id: str(64), q: str(500), a: str(8000), tags: z.array(str(40)).max(20).optional() });
const fieldDef = z.looseObject({ key: str(64), label: str(100) });
const profile = z.record(str(64), str(900_000));
const socialLink = z.looseObject({
  id: str(64),
  platform: str(32),
  label: str(80),
  url: str(2000),
  previewTitle: optStr(200),
});
const tagGroup = z.looseObject({
  id: str(64),
  name: str(80),
  tags: z.array(str(40)).max(50),
  required: z.boolean().optional(),
});

export const createProjectSchema = z.object({
  title: str(120),
  summary: str(2000),
  cover_url: optStr(900_000),
  icon_url: optStr(900_000),
  visibility: z.enum(['public', 'unlisted']).optional(),
  join_mode: z.enum(['open', 'code']),
  join_code: optStr(100),
  owner_discord_id: optStr(100),
  turnstile: optStr(900_000),
  links: z.array(socialLink).max(8).optional(),
});

export const projectPatchSchema = z.object({
  title: str(120).optional(),
  summary: str(2000).optional(),
  world_note: str(20000).optional(),
  world_blocks: z.array(worldBlock).max(50).optional(),
  qa: z.array(qaItem).max(100).optional(),
  cover_url: z.union([z.literal(''), str(900_000)]).optional(),
  icon_url: z.union([z.literal(''), str(900_000)]).optional(),
  visibility: z.enum(['public', 'unlisted']).optional(),
  join_mode: z.enum(['open', 'code']).optional(),
  signups_open: z.boolean().optional(),
  join_code: str(100).optional(),
  announcement: str(2000).optional(),
  field_schema: z.array(fieldDef).max(50).optional(),
  tag_groups: z.array(tagGroup).max(20).optional(),
  links: z.array(socialLink).max(8).optional(),
  expected_rev: z.number().int().optional(), // §7 樂觀鎖：有帶就檢查，沒帶就沿用舊行為直接覆蓋
});

export const joinSchema = z.object({
  name: str(40),
  one_liner: optStr(200),
  avatar_url: z.union([z.literal(''), str(900_000)]).optional(),
  profile: profile.optional(),
  blocks: z.array(worldBlock).max(50).optional(),
  links: z.array(socialLink).max(8).optional(),
  tags: z.array(str(40)).max(40).optional(),
  join_code: optStr(100),
  turnstile: optStr(900_000),
});

export const characterPatchSchema = z.object({
  name: str(40).optional(),
  one_liner: str(200).optional(),
  avatar_url: z.union([z.literal(''), str(900_000)]).optional(),
  profile: profile.optional(),
  blocks: z.array(worldBlock).max(50).optional(),
  links: z.array(socialLink).max(8).optional(),
  tags: z.array(str(40)).max(40).optional(),
});

export const shareNoteSchema = z.object({ note: str(140) });

export const privateRelationCreateSchema = z.object({ ghostName: str(40), label: str(40).optional(), note: str(2000).optional() });

export const privateRelationUpdateSchema = z.object({ label: str(40).optional(), note: str(2000).optional() });

export const privateRelationPromoteSchema = z.object({ turnstile: optStr(900_000) });

export const tokenSchema = z.object({ token: optStr(128) });

export const initiateSchema = z.object({
  targetId: str(64),
  label: str(100),
  note: str(2000),
  turnstile: optStr(900_000),
});

export const respondSchema = z.object({
  charId: str(64),
  action: z.enum(['accept', 'decline']),
  label: str(100),
  note: str(2000),
});

export const sidePatchSchema = z.object({
  charId: str(64),
  label: str(100),
  note: str(2000),
});

export const addNoteSchema = z.object({ charId: str(64), body: str(1000) });

export const deleteNoteSchema = z.object({ charId: str(64) });

export const unwireSchema = z.object({ charId: str(64) });
