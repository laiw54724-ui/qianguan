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

app.post('/api/p/:slug/c/:charId/draft-char', async (c) => {
  const d = db(c);
  if (!(await requireChar(d, c.req.param('slug'), c.req.param('charId'), cookieOf(c)))) {
    return c.json({ error: AUTH_FAIL }, 401);
  }
  const input = await parseBody(c, schema.draftCharSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  const r = await charSvc.createDraftChar(d, c.req.param('slug'), cookieOf(c), input.name);
  if ('error' in r) return c.json({ error: r.error }, 400);
  c.header('Set-Cookie', r.cookie, { append: true });
  return c.json({ ok: true, character: r.character, charToken: r.charToken });
});

// ================= 牽線 =================

app.post('/api/p/:slug/c/:charId/relations', async (c) => {
  const d = db(c);
  const got = await requireChar(d, c.req.param('slug'), c.req.param('charId'), cookieOf(c));
  if (!got) return c.json({ error: AUTH_FAIL }, 401);
  const input = await parseBody(c, schema.initiateSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  if (!(await ts(c, input.turnstile))) return c.json({ error: '人機驗證未通過，請再試一次' }, 403);
  const r = await relSvc.initiate(d, got.project.id, got.character.id, input.targetId, input.label, input.note, input.extras ?? []);
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

app.patch('/api/p/:slug/relations/:id/extras', async (c) => {
  const d = db(c);
  const input = await parseBody(c, schema.extrasPatchSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  const got = await requireChar(d, c.req.param('slug'), input.charId, cookieOf(c));
  if (!got) return c.json({ error: AUTH_FAIL }, 401);
  const r = await relSvc.patchExtras(d, got.project.id, Number(c.req.param('id')), got.character.id, input.extras);
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

  // 不存在或不公開：只給通用 meta，絕不輸出真實標題／封面（§11）
  if (!p || p.visibility !== 'public') {
    const res = new HTMLRewriter()
      .on('title', new HeadRewriter({ title: site, description: '多人 OC 牽線企劃', image: null }, null))
      .on('head', new HeadRewriter({ title: site, description: '', image: null }, `/#/p/${slug}${charId ? `/c/${charId}` : ''}`))
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
  const redirect = `/#/p/${slug}${charId ? `/c/${charId}` : ''}`;
  return new HTMLRewriter()
    .on('title', new HeadRewriter(meta, null))
    .on('head', new HeadRewriter(meta, redirect))
    .on('meta', new HeadRewriter(meta, null))
    .transform(asset);
}

app.get('/p/:slug', (c) => servePage(c, c.req.param('slug')));
app.get('/p/:slug/c/:charId', (c) => servePage(c, c.req.param('slug'), c.req.param('charId')));

// 其餘一律交給靜態資產（SPA）
app.all('*', (c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: AUTH_FAIL }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
