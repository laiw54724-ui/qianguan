// 唯一的 fetch 封裝 — 對外暴露與原型 lib/store.ts 完全相同的函式名與參數，元件層不用改。
// 規格 §6.3：所有 mutation 統一在這裡帶 X-KG: 1 自訂標頭；任何元件不得自己呼叫 fetch。
// 權杖走 httpOnly cookie（credentials: 'same-origin'）；貼碼救援時把 token 放 body，後端驗過會順手種 cookie。
import type { Character, FieldDef, JoinMode, KgEvent, Project, Relation, RelationExtra, TagGroup, Visibility, WorldBlock } from './types';
import type { SocialLink } from './links';

const BASE = '/api';

export const AUTH_FAIL = '企劃不存在或權杖錯誤';
export const FEED_LIMIT = 30;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      'X-KG': '1',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, (data.error as string) || AUTH_FAIL);
  return data as T;
}

type Result = { ok: true } | { ok: false; error: string };

async function tryReq<T extends Result>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await req<T>(method, path, body);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : AUTH_FAIL } as T;
  }
}

// ---------- 讀者身分（由 cookie 推斷，前端不碰權杖） ----------
export interface Viewer {
  isOwner: boolean;
  myCharIds: string[];
}

export type ProjectView = Project & { viewer: Viewer };
export type CharacterView = { project: Project; character: Character; viewer: { owned: boolean; isOwner: boolean } };

// ---------- 企劃 ----------
export interface NewProjectInput {
  title: string;
  summary: string;
  cover_url: string;
  icon_url: string;
  visibility: Visibility;
  join_mode: JoinMode;
  join_code?: string;
  turnstile?: string; // Turnstile token（§6.6）
  links?: SocialLink[];
}

export async function listPublicProjects(): Promise<Project[]> {
  return req<Project[]>('GET', '/projects');
}

export async function findSimilarProjects(title: string): Promise<Project[]> {
  return req<Project[]>('GET', `/projects/similar?title=${encodeURIComponent(title)}`);
}

export async function fetchLinkPreview(url: string): Promise<{ title: string }> {
  try {
    return await req<{ title: string }>('GET', `/link-preview?url=${encodeURIComponent(url)}`);
  } catch {
    return { title: '' };
  }
}

export async function createProject(input: NewProjectInput): Promise<{ project: Project; ownerToken: string }> {
  // 回應同時種 kg_o_ cookie；ownerToken 只出現這一次（畫面顯示一次，§4.1）
  return req('POST', '/projects', input);
}

export async function getProject(slug: string): Promise<ProjectView | undefined> {
  try {
    return await req<ProjectView>('GET', `/p/${encodeURIComponent(slug)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return undefined;
    throw e;
  }
}

/** 開設者身分驗證：cookie 優先；貼碼救援時帶 token，成功即種 cookie */
export async function verifyOwner(slug: string, token = ''): Promise<Project | null> {
  try {
    const r = await req<{ project: Project }>('POST', `/p/${encodeURIComponent(slug)}/owner-session`, { token });
    return r.project;
  } catch {
    return null;
  }
}

export interface ProjectPatch {
  title: string;
  summary: string;
  cover_url: string;
  icon_url: string;
  visibility: Visibility;
  join_mode: JoinMode;
  join_code?: string; // 明文只在這次請求出現；後端立即雜湊（§12：不再有發布時才雜湊）
  signups_open: boolean;
  world_blocks: WorldBlock[];
  qa: { id: string; q: string; a: string; tags?: string[] }[];
  field_schema: FieldDef[];
  tag_groups?: TagGroup[];
  links?: SocialLink[];
  expected_rev?: number; // §7 樂觀鎖：帶目前讀到的 rev，後端偵測到別人已經更新過會回衝突而不是靜默覆蓋
}

export async function updateProject(slug: string, patch: ProjectPatch): Promise<Result> {
  return tryReq('PATCH', `/p/${encodeURIComponent(slug)}`, patch);
}

export async function removeCharacter(slug: string, _token: string, charId: string): Promise<Result> {
  return tryReq('DELETE', `/p/${encodeURIComponent(slug)}/c/${encodeURIComponent(charId)}`);
}

export interface RosterRow {
  character: Character;
  unfilled: number;
  relationCount: number;
}

export async function rosterStats(slug: string): Promise<RosterRow[]> {
  return req<RosterRow[]>('GET', `/p/${encodeURIComponent(slug)}/roster`);
}

// ---------- 角色 ----------
export interface JoinInput {
  name: string;
  one_liner: string;
  avatar_url: string;
  profile: Record<string, string>;
  blocks?: WorldBlock[];
  links?: SocialLink[];
  tags?: string[];
  claim_id?: string;
  join_code?: string;
  turnstile?: string;
}

export async function joinProject(
  slug: string,
  input: JoinInput,
): Promise<{ ok: true; character: Character; charToken: string } | { ok: false; error: string }> {
  // 成功時回應種 kg_c_ cookie；charToken 只出現這一次
  return tryReq('POST', `/p/${encodeURIComponent(slug)}/join`, input);
}

export async function listCharacters(slug: string): Promise<Character[]> {
  return req<Character[]>('GET', `/p/${encodeURIComponent(slug)}/chars`);
}

export async function searchCharacters(slug: string, query: string, excludeId?: string): Promise<Character[]> {
  const kw = query.trim().toLowerCase();
  const all = await listCharacters(slug);
  return all.filter((c) => c.id !== excludeId).filter((c) => !kw || c.name.toLowerCase().includes(kw));
}

export async function getCharacter(slug: string, charId: string): Promise<CharacterView | null> {
  try {
    return await req<CharacterView>('GET', `/p/${encodeURIComponent(slug)}/c/${encodeURIComponent(charId)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** 角色本人驗證：cookie 優先；貼編輯碼救援時帶 token，成功即種 cookie */
export async function verifyCharToken(slug: string, charId: string, token = ''): Promise<Character | null> {
  try {
    const r = await req<{ character: Character }>('POST', `/p/${encodeURIComponent(slug)}/c/${encodeURIComponent(charId)}/session`, { token });
    return r.character;
  } catch {
    return null;
  }
}

export interface CharacterPatch {
  name: string;
  one_liner: string;
  avatar_url: string;
  profile: Record<string, string>;
  blocks?: WorldBlock[];
  links?: SocialLink[];
  tags?: string[];
}

export async function updateCharacter(slug: string, charId: string, _token: string, patch: CharacterPatch): Promise<Result> {
  // 首次儲存 draft→active 由後端處理（§12：新建角色在完成前不公開）
  return tryReq('PATCH', `/p/${encodeURIComponent(slug)}/c/${encodeURIComponent(charId)}`, patch);
}

export async function createDraftCharacter(
  slug: string,
  charId: string,
  _token: string,
  name: string,
): Promise<{ ok: true; character: Character; charToken: string } | { ok: false; error: string }> {
  return tryReq('POST', `/p/${encodeURIComponent(slug)}/c/${encodeURIComponent(charId)}/draft-char`, { name });
}

// ---------- 牽線 ----------
export function sideOf(rel: Relation, charId: string): 'a' | 'b' | null {
  if (rel.a_id === charId) return 'a';
  if (rel.b_id === charId) return 'b';
  return null;
}

export async function initiateRelation(
  slug: string,
  charId: string,
  _token: string,
  targetId: string,
  label: string,
  note: string,
  extras: RelationExtra[] = [],
  turnstile = '',
): Promise<Result> {
  return tryReq('POST', `/p/${encodeURIComponent(slug)}/c/${encodeURIComponent(charId)}/relations`, {
    targetId,
    label,
    note,
    extras,
    turnstile,
  });
}

export async function respondRelation(
  slug: string,
  charId: string,
  _token: string,
  relId: number,
  action: 'accept' | 'decline',
  label: string,
  note: string,
): Promise<Result> {
  return tryReq('POST', `/p/${encodeURIComponent(slug)}/relations/${relId}/respond`, { charId, action, label, note });
}

export async function updateRelationSide(
  slug: string,
  charId: string,
  _token: string,
  relId: number,
  label: string,
  note: string,
): Promise<Result> {
  return tryReq('PATCH', `/p/${encodeURIComponent(slug)}/relations/${relId}/side`, { charId, label, note });
}

export async function updateRelationExtras(
  slug: string,
  charId: string,
  _token: string,
  relId: number,
  extras: RelationExtra[],
): Promise<Result> {
  return tryReq('PATCH', `/p/${encodeURIComponent(slug)}/relations/${relId}/extras`, { charId, extras });
}

export async function unwireRelation(slug: string, charId: string, _token: string, relId: number): Promise<Result> {
  return tryReq('POST', `/p/${encodeURIComponent(slug)}/relations/${relId}/unwire`, { charId });
}

export async function relationsForChar(slug: string, charId: string): Promise<Relation[]> {
  // 伺服器依 cookie 過濾：pending/declined 只回給當事雙方與開設者
  return req<Relation[]>('GET', `/p/${encodeURIComponent(slug)}/c/${encodeURIComponent(charId)}/relations`);
}

export async function acceptedRelations(slug: string): Promise<Relation[]> {
  return req<Relation[]>('GET', `/p/${encodeURIComponent(slug)}/relations`);
}

// ---------- 動態牆 ----------
export async function feed(slug: string, before?: number): Promise<KgEvent[]> {
  const q = before !== undefined ? `?before=${before}` : '';
  return req<KgEvent[]>('GET', `/p/${encodeURIComponent(slug)}/feed${q}`);
}
