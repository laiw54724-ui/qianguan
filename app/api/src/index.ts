// 牽關 API — Hono on Cloudflare Workers + D1
// 路由處理器只做「驗參數 → 呼叫 service → 回傳」；商業邏輯全部在 services/。
// 權杖走 httpOnly cookie；貼碼救援由 .../session 端點驗過後種 cookie。
// 安全失敗訊息統一 AUTH_FAIL（§6.9），不區分「不存在」與「權杖錯」。

import { Hono, type Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { characters, type ProjectRow } from './db/schema';
import { AUTH_FAIL, sha256hex } from './auth/token';
import { charTokens, ownerToken } from './auth/guard';
import { csrfGuard, securityHeaders, rateLimitGuard } from './middleware/security';
import { verifyTurnstile } from './turnstile';
import * as schema from './schemas';
import * as projectSvc from './services/project';
import * as charSvc from './services/character';
import * as relSvc from './services/relation';
import * as privRelSvc from './services/privateRelation';
import * as eventSvc from './services/event';
import { fetchPageTitle } from './services/preview';

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  TURNSTILE_SECRET?: string;
  PUBLIC_SITE_NAME?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', securityHeaders);
app.use('/api/*', csrfGuard);
app.use('/api/*', rateLimitGuard);

type Ctx = Context<{ Bindings: Bindings }>;
const db = (c: Ctx): DrizzleD1Database => drizzle(c.env.DB);
const cookieOf = (c: Ctx) => c.req.header('Cookie');

async function parseBody<T>(c: { req: { json: () => Promise<unknown> } }, s: z.ZodType<T>): Promise<T | null> {
  const raw = await c.req.json().catch(() => null);
  if (!raw) return null;
  const r = s.safeParse(raw);
  return r.success ? r.data : null;
}

// ---- viewer / 權杖 helpers ----

async function isOwnerReq(p: ProjectRow, cookieHeader?: string) {
  const t = ownerToken(cookieHeader, p.id);
  return !!t && (await sha256hex(t)) === p.ownerTokenHash;
}

async function ownedCharIds(d: DrizzleD1Database, projectId: string, cookieHeader?: string) {
  const tokens = charTokens(cookieHeader, projectId);
  if (!tokens.length) return [] as string[];
  const hashes = await Promise.all(tokens.map((t) => sha256hex(t)));
  const rows = await d.select({ id: characters.id }).from(characters)
    .where(and(eq(characters.projectId, projectId), inArray(characters.editTokenHash, hashes), ne(characters.status, 'removed')));
  return rows.map((r) => r.id);
}

/** 開設者或持有任一角色權杖 */
async function requireOwner(d: DrizzleD1Database, slug: string, cookieHeader?: string) {
  const p = await projectSvc.getProjectRaw(d, slug);
  if (!p) return null;
  return (await isOwnerReq(p, cookieHeader)) ? p : null;
}

/** 持有「這一隻角色」的權杖 */
async function requireChar(d: DrizzleD1Database, slug: string, charId: string, cookieHeader?: string) {
  const got = await charSvc.getChar(d, slug, charId);
  if (!got) return null;
  const tokens = charTokens(cookieHeader, got.project.id);
  for (const t of tokens) {
    if ((await sha256hex(t)) === got.character.editTokenHash) return got;
  }
  return null;
}

const ts = (c: Ctx, token?: string) =>
  verifyTurnstile(c.env.TURNSTILE_SECRET, token, c.req.header('CF-Connecting-IP'));

// ================= 公開端點 =================

app.get('/api/projects', async (c) => c.json(await projectSvc.listPublicProjects(db(c))));

app.get('/api/link-preview', async (c) => {
  const url = (c.req.query('url') ?? '').trim();
  if (!url) return c.json({ title: '' });
  // GET 不走 mutation 節流，這裡單獨擋一下以免被拿去當開放 proxy
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const { success } = await c.env.RATE_LIMITER.limit({ key: `preview:${ip}` });
  if (!success) return c.json({ error: '操作太頻繁，請稍後再試' }, 429);
  return c.json(await fetchPageTitle(url));
});

app.get('/api/projects/similar', async (c) =>
  c.json(await projectSvc.findSimilarProjects(db(c), c.req.query('title') ?? '')));

app.post('/api/projects', async (c) => {
  const input = await parseBody(c, schema.createProjectSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  if (!input.title.trim()) return c.json({ error: '企劃名不能留空' }, 400);
  if (!(await ts(c, input.turnstile))) return c.json({ error: '人機驗證未通過，請再試一次' }, 403);
  const r = await projectSvc.createProject(db(c), input);
  c.header('Set-Cookie', r.cookie, { append: true });
  return c.json({ project: r.project, ownerToken: r.ownerToken, transferCode: r.transferCode });
});

app.get('/api/p/:slug', async (c) => {
  const d = db(c);
  const p = await projectSvc.getProjectRaw(d, c.req.param('slug'));
  if (!p) return c.json({ error: AUTH_FAIL }, 404);
  const viewer = {
    isOwner: await isOwnerReq(p, cookieOf(c)),
    myCharIds: await ownedCharIds(d, p.id, cookieOf(c)),
  };
  return c.json({ ...projectSvc.toProject(p), viewer });
});

app.get('/api/p/:slug/chars', async (c) => {
  const d = db(c);
  const p = await projectSvc.getProjectRaw(d, c.req.param('slug'));
  if (!p) return c.json({ error: AUTH_FAIL }, 404);
  return c.json(await charSvc.listChars(d, p.id));
});

app.get('/api/p/:slug/c/:charId', async (c) => {
  const d = db(c);
  const got = await charSvc.getChar(d, c.req.param('slug'), c.req.param('charId'));
  if (!got) return c.json({ error: AUTH_FAIL }, 404);
  // draft 角色只有本人與開設者看得見（§12：完成前不公開）
  const owner = await isOwnerReq(got.project, cookieOf(c));
  const mine = (await ownedCharIds(d, got.project.id, cookieOf(c))).includes(got.character.id);
  if (got.character.status === 'draft' && !owner && !mine) return c.json({ error: AUTH_FAIL }, 404);
  return c.json({
    project: projectSvc.toProject(got.project),
    character: charSvc.toChar(got.character),
    viewer: { owned: mine, isOwner: owner },
  });
});

app.get('/api/p/:slug/relations', async (c) => {
  const d = db(c);
  const p = await projectSvc.getProjectRaw(d, c.req.param('slug'));
  if (!p) return c.json({ error: AUTH_FAIL }, 404);
  return c.json(await relSvc.accepted(d, p.id));
});

app.get('/api/p/:slug/feed', async (c) => {
  const d = db(c);
  const p = await projectSvc.getProjectRaw(d, c.req.param('slug'));
  if (!p) return c.json({ error: AUTH_FAIL }, 404);
  const before = Number(c.req.query('before'));
  return c.json(await eventSvc.feed(d, p.id, Number.isFinite(before) && before > 0 ? before : undefined));
});

// ================= 開設者 =================

// 貼碼救援：驗過就種 cookie（§4.2）
app.post('/api/p/:slug/owner-session', async (c) => {
  const input = await parseBody(c, schema.tokenSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  const r = await projectSvc.verifyOwner(db(c), c.req.param('slug'), cookieOf(c), input.token ?? '');
  if (!r) {
    // §A09：這條沒掛 Turnstile（§6.6），記失敗次數供異常偵測；權杖本身不入 log
    console.warn(`owner-session auth fail: slug=${c.req.param('slug')} ip=${c.req.header('CF-Connecting-IP') ?? 'unknown'}`);
    return c.json({ error: AUTH_FAIL }, 401);
  }
  if (r.cookie) c.header('Set-Cookie', r.cookie, { append: true });
  return c.json({ project: r.project });
});

app.patch('/api/p/:slug', async (c) => {
  const d = db(c);
  if (!(await requireOwner(d, c.req.param('slug'), cookieOf(c)))) return c.json({ error: AUTH_FAIL }, 401);
  const patch = await parseBody(c, schema.projectPatchSchema);
  if (!patch) return c.json({ error: '參數格式不正確' }, 400);
  const r = await projectSvc.patchProject(d, c.req.param('slug'), patch);
  if ('error' in r) return c.json({ error: r.error }, r.conflict ? 409 : 400);
  return c.json(r);
});

app.get('/api/p/:slug/roster', async (c) => {
  const d = db(c);
  if (!(await requireOwner(d, c.req.param('slug'), cookieOf(c)))) return c.json({ error: AUTH_FAIL }, 401);
  return c.json(await projectSvc.roster(d, c.req.param('slug')));
});

app.delete('/api/p/:slug/c/:charId', async (c) => {
  const d = db(c);
  if (!(await requireOwner(d, c.req.param('slug'), cookieOf(c)))) return c.json({ error: AUTH_FAIL }, 401);
  const r = await charSvc.removeChar(d, c.req.param('slug'), c.req.param('charId'));
  if ('error' in r) return c.json({ error: r.error }, 400);
  return c.json({ ok: true });
});

// ================= 角色 =================

app.post('/api/p/:slug/join', async (c) => {
  const input = await parseBody(c, schema.joinSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  if (!(await ts(c, input.turnstile))) return c.json({ error: '人機驗證未通過，請再試一次' }, 403);
  const r = await charSvc.joinProject(db(c), c.req.param('slug'), cookieOf(c), input);
  if ('error' in r) return c.json({ error: r.error }, 400);
  c.header('Set-Cookie', r.cookie, { append: true });
  return c.json({ ok: true, character: r.character, charToken: r.charToken });
});

// 貼編輯碼救援：驗過就種 cookie
app.post('/api/p/:slug/c/:charId/session', async (c) => {
  const input = await parseBody(c, schema.tokenSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  const r = await charSvc.verifyCharToken(db(c), c.req.param('slug'), c.req.param('charId'), cookieOf(c), input.token ?? '');
  if (!r) {
    console.warn(`char-session auth fail: slug=${c.req.param('slug')} charId=${c.req.param('charId')} ip=${c.req.header('CF-Connecting-IP') ?? 'unknown'}`);
    return c.json({ error: AUTH_FAIL }, 401);
  }
  if (r.cookie) c.header('Set-Cookie', r.cookie, { append: true });
  return c.json({ character: r.character });
});

app.patch('/api/p/:slug/c/:charId', async (c) => {
  const d = db(c);
  if (!(await requireChar(d, c.req.param('slug'), c.req.param('charId'), cookieOf(c)))) {
    return c.json({ error: AUTH_FAIL }, 401);
  }
  const patch = await parseBody(c, schema.characterPatchSchema);
  if (!patch) return c.json({ error: '參數格式不正確' }, 400);
  const r = await charSvc.patchChar(d, c.req.param('slug'), c.req.param('charId'), patch);
  if ('error' in r) return c.json({ error: r.error }, 400);
  return c.json(r);
});

// 1-3：存檔後才問的「要不要跟大家說一聲？」——只發動態事件，不動角色欄位本身
app.post('/api/p/:slug/c/:charId/share', async (c) => {
  const d = db(c);
  const slug = c.req.param('slug');
  const charId = c.req.param('charId');
  if (!(await requireChar(d, slug, charId, cookieOf(c)))) {
    return c.json({ error: AUTH_FAIL }, 401);
  }
  const input = await parseBody(c, schema.shareNoteSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  const r = await charSvc.shareCharUpdate(d, slug, charId, input.note);
  if ('error' in r) return c.json({ error: r.error }, 400);
  return c.json(r);
});

// 1-4「重看編輯碼」：已經持有有效 kg_c_ cookie（人已經在自己的角色頁），
// 不用再貼一次碼，直接發一組新的權杖取代舊的（舊碼因此失效，見 auth/guard.ts）
app.post('/api/p/:slug/c/:charId/rotate-token', async (c) => {
  const d = db(c);
  const slug = c.req.param('slug');
  const charId = c.req.param('charId');
  if (!(await requireChar(d, slug, charId, cookieOf(c)))) {
    return c.json({ error: AUTH_FAIL }, 401);
  }
  const r = await charSvc.rotateCharToken(d, slug, charId, cookieOf(c));
  if ('error' in r) return c.json({ error: r.error }, 401);
  c.header('Set-Cookie', r.cookie, { append: true });
  return c.json({ ok: true, character: r.character, charToken: r.charToken });
});

// ================= 1.5-2：單人可用性（private_relations，取代 draft-char）=================

app.get('/api/p/:slug/c/:charId/private-relations', async (c) => {
  const d = db(c);
  const got = await requireChar(d, c.req.param('slug'), c.req.param('charId'), cookieOf(c));
  if (!got) return c.json({ error: AUTH_FAIL }, 401);
  return c.json(await privRelSvc.listFor(d, got.project.id, got.character.id));
});

app.post('/api/p/:slug/c/:charId/private-relations', async (c) => {
  const d = db(c);
  const got = await requireChar(d, c.req.param('slug'), c.req.param('charId'), cookieOf(c));
  if (!got) return c.json({ error: AUTH_FAIL }, 401);
  const input = await parseBody(c, schema.privateRelationCreateSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  if (!input.ghostName.trim()) return c.json({ error: '名字不能留空' }, 400);
  const r = await privRelSvc.create(d, got.project.id, got.character.id, input.ghostName, input.label ?? '', input.note ?? '');
  return c.json(r);
});

app.patch('/api/p/:slug/c/:charId/private-relations/:id', async (c) => {
  const d = db(c);
  const got = await requireChar(d, c.req.param('slug'), c.req.param('charId'), cookieOf(c));
  if (!got) return c.json({ error: AUTH_FAIL }, 401);
  const input = await parseBody(c, schema.privateRelationUpdateSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  const r = await privRelSvc.update(d, got.character.id, Number(c.req.param('id')), input.label ?? '', input.note ?? '');
  if ('error' in r) return c.json({ error: r.error }, 404);
  return c.json(r);
});

app.delete('/api/p/:slug/c/:charId/private-relations/:id', async (c) => {
  const d = db(c);
  const got = await requireChar(d, c.req.param('slug'), c.req.param('charId'), cookieOf(c));
  if (!got) return c.json({ error: AUTH_FAIL }, 401);
  const ok = await privRelSvc.remove(d, got.character.id, Number(c.req.param('id')));
  if (!ok) return c.json({ error: AUTH_FAIL }, 404);
  return c.json({ ok: true });
});

// 轉正：對著一筆有 suggested_char_id 的私人紀錄按下去，重用既有的 relSvc.initiate() 送出正式邀請，
// 成功才標記這筆私人紀錄已連結——不是新邏輯，是既有牽線流程的一個入口。
app.post('/api/p/:slug/c/:charId/private-relations/:id/promote', async (c) => {
  const d = db(c);
  const got = await requireChar(d, c.req.param('slug'), c.req.param('charId'), cookieOf(c));
  if (!got) return c.json({ error: AUTH_FAIL }, 401);
  const rows = await privRelSvc.listFor(d, got.project.id, got.character.id);
  const target = rows.find((r) => r.id === Number(c.req.param('id')));
  if (!target || !target.suggested_char_id) return c.json({ error: '找不到可以轉正的對象' }, 400);
  const r = await relSvc.initiate(d, got.project.id, got.character.id, target.suggested_char_id, target.label || target.ghost_name, target.note);
  if ('error' in r) return c.json({ error: r.error }, 400);
  await privRelSvc.markLinked(d, got.character.id, target.id, target.suggested_char_id);
  return c.json({ ok: true, relation: r.relation });
});

// ================= 牽線 =================

app.post('/api/p/:slug/c/:charId/relations', async (c) => {
  const d = db(c);
  const got = await requireChar(d, c.req.param('slug'), c.req.param('charId'), cookieOf(c));
  if (!got) return c.json({ error: AUTH_FAIL }, 401);
  const input = await parseBody(c, schema.initiateSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  if (!(await ts(c, input.turnstile))) return c.json({ error: '人機驗證未通過，請再試一次' }, 403);
  const r = await relSvc.initiate(d, got.project.id, got.character.id, input.targetId, input.label, input.note);
  if ('error' in r) return c.json({ error: r.error }, 400);
  return c.json({ ok: true });
});

// 當事人（或開設者）才能看 pending/declined
app.get('/api/p/:slug/c/:charId/relations', async (c) => {
  const d = db(c);
  const slug = c.req.param('slug');
  const charId = c.req.param('charId');
  const got = await requireChar(d, slug, charId, cookieOf(c));
  if (!got && !(await requireOwner(d, slug, cookieOf(c)))) return c.json({ error: AUTH_FAIL }, 401);
  return c.json(await relSvc.forChar(d, got ? got.project.id : (await projectSvc.getProjectRaw(d, slug))!.id, charId));
});

app.post('/api/p/:slug/relations/:id/respond', async (c) => {
  const d = db(c);
  const input = await parseBody(c, schema.respondSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  const got = await requireChar(d, c.req.param('slug'), input.charId, cookieOf(c));
  if (!got) return c.json({ error: AUTH_FAIL }, 401);
  const r = await relSvc.respond(d, got.project.id, Number(c.req.param('id')), got.character.id, input.action, input.label, input.note);
  if ('error' in r) return c.json({ error: r.error }, 400);
  return c.json({ ok: true });
});

app.patch('/api/p/:slug/relations/:id/side', async (c) => {
  const d = db(c);
  const input = await parseBody(c, schema.sidePatchSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  const got = await requireChar(d, c.req.param('slug'), input.charId, cookieOf(c));
  if (!got) return c.json({ error: AUTH_FAIL }, 401);
  const r = await relSvc.patchSide(d, got.project.id, Number(c.req.param('id')), got.character.id, input.label, input.note);
  if ('error' in r) return c.json({ error: r.error }, 400);
  return c.json({ ok: true });
});

// 雙方共用的互動筆記（1.5-1，取代原本的 extras）
app.post('/api/p/:slug/relations/:id/notes', async (c) => {
  const d = db(c);
  const input = await parseBody(c, schema.addNoteSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  const got = await requireChar(d, c.req.param('slug'), input.charId, cookieOf(c));
  if (!got) return c.json({ error: AUTH_FAIL }, 401);
  const r = await relSvc.addNote(d, got.project.id, Number(c.req.param('id')), got.character.id, input.body);
  if ('error' in r) return c.json({ error: r.error }, 400);
  return c.json(r);
});

app.delete('/api/p/:slug/relations/:id/notes/:noteId', async (c) => {
  const d = db(c);
  const input = await parseBody(c, schema.deleteNoteSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  const got = await requireChar(d, c.req.param('slug'), input.charId, cookieOf(c));
  if (!got) return c.json({ error: AUTH_FAIL }, 401);
  const r = await relSvc.deleteNote(d, got.project.id, Number(c.req.param('id')), Number(c.req.param('noteId')), got.character.id);
  if ('error' in r) return c.json({ error: r.error }, 400);
  return c.json({ ok: true });
});

app.post('/api/p/:slug/relations/:id/unwire', async (c) => {
  const d = db(c);
  const input = await parseBody(c, schema.unwireSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  const got = await requireChar(d, c.req.param('slug'), input.charId, cookieOf(c));
  if (!got) return c.json({ error: AUTH_FAIL }, 401);
  const r = await relSvc.unwire(d, got.project.id, Number(c.req.param('id')), got.character.id);
  if ('error' in r) return c.json({ error: r.error }, 400);
  return c.json({ ok: true });
});

// ================= §11 OG meta（HTMLRewriter，對所有請求改寫，不嗅探 UA） =================

class HeadRewriter {
  constructor(
    private meta: { title: string; description: string; image: string | null },
    // path routing 上線後（見工單 P2 第一步）沒有任何呼叫端會傳非 null 進來了——
    // JS 會在同一個網址原地接手，不用再靠這裡轉址；留著這個參數但沒人用，之後若要整個拿掉
    // 要一併改 servePage() 的三個呼叫點。
    private redirect: string | null,
  ) {}
  element(el: Element) {
    if (el.tagName === 'title') {
      el.setInnerContent(this.meta.title);
      return;
    }
    if (el.tagName === 'head' && this.redirect) {
      // meta refresh 而非 inline script：CSP script-src 不含 'unsafe-inline'，inline script 會被擋
      el.prepend(`<meta http-equiv="refresh" content="0; url=${this.redirect}">`, { html: true });
      return;
    }
    const key = el.getAttribute('property') ?? el.getAttribute('name');
    if (key === 'og:title' || key === 'twitter:title' || key === 'og:site_name') {
      el.setAttribute('content', this.meta.title);
    } else if (key === 'og:description' || key === 'twitter:description' || key === 'description') {
      el.setAttribute('content', this.meta.description);
    } else if ((key === 'og:image' || key === 'twitter:image') && this.meta.image) {
      el.setAttribute('content', this.meta.image);
    }
  }
}

// 圖片管線還沒接 R2（見《牽關-問題整理與工單.md》0-2），封面／頭像常是 data: URI。
// OG crawler（Discord/Facebook/X…）不會抓 data: URI，硬塞只會讓卡片沒有圖——
// 遇到非 http(s) 的圖一律當沒有圖，讓 HeadRewriter 不覆寫，繼承外殼預設的 og-default.png。
function ogImageOrNull(url: string | null): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

async function servePage(c: Ctx, slug: string, charId?: string) {
  const d = db(c);
  const asset = await c.env.ASSETS.fetch(new Request(new URL('/', c.req.url).toString(), c.req.raw));
  const p = await projectSvc.getProjectRaw(d, slug);
  const site = c.env.PUBLIC_SITE_NAME || '牽關';

  // 不存在或不公開：只給通用 meta，絕不輸出真實標題／封面（§11）。
  // path routing 下不用再轉址——JS 會在同一個網址原地接手，這裡只要把 meta 換成通用版本即可。
  if (!p || p.visibility !== 'public') {
    const res = new HTMLRewriter()
      .on('title', new HeadRewriter({ title: site, description: '多人 OC 牽線企劃', image: null }, null))
      .on('meta', new HeadRewriter({ title: site, description: '多人 OC 牽線企劃', image: null }, null))
      .transform(asset);
    const r2 = new Response(res.body, res);
    r2.headers.set('X-Robots-Tag', 'noindex');
    return r2;
  }

  let title = `${p.title} | ${site}`;
  let description = p.summary || '多人 OC 牽線企劃';
  let image = ogImageOrNull(p.coverUrl);
  if (charId) {
    const ch = await charSvc.getCharRaw(d, p.id, charId);
    if (ch && ch.status === 'active') {
      title = `${ch.name} | ${p.title}`;
      description = ch.oneLiner || description;
      image = ogImageOrNull(ch.avatarUrl) || image;
    }
  }
  const meta = { title, description, image };
  return new HTMLRewriter()
    .on('title', new HeadRewriter(meta, null))
    .on('meta', new HeadRewriter(meta, null))
    .transform(asset);
}

app.get('/p/:slug', (c) => servePage(c, c.req.param('slug')));
app.get('/p/:slug/c/:charId', (c) => servePage(c, c.req.param('slug'), c.req.param('charId')));

// 其餘一律交給靜態資產；真的存在的檔案（JS/CSS/圖片、favicon…）直接回，
// 其餘（SPA 路由，例如 /p/xxx/manage——沒有對應的實體檔案）都退回 index.html，
// 讓前端路由自己讀 window.location.pathname 接手（path routing，不再靠 hash）。
app.all('*', async (c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: AUTH_FAIL }, 404);
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.status !== 404) return res;
  // 明確拿 /index.html，不是拿 c.req.raw 改個網址重送——
  // 這條 catch-all 是 app.all('*')，任何方法都會進來，把原始請求（可能是 POST 帶 body）
  // 原封不動轉去 '/' 會把 method/body 一起帶過去，語意不對且某些 runtime 會直接拋錯。
  // 也不能信任 ASSETS 對 '/' 的回應狀態碼，這裡是給爬蟲／使用者看的頁面殼，一定要回 200，
  // 否則爬蟲會判定頁面不存在，OG meta 就白做了。
  const shell = await c.env.ASSETS.fetch(new URL('/index.html', c.req.url));
  return new Response(shell.body, { status: 200, headers: shell.headers });
});

export default app;
