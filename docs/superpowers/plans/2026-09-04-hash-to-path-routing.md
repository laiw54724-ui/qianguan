# Hash → Path Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把牽關前端從 hash routing（`/#/p/xxx/c/yyy`）換成真正的路徑（`/p/xxx/c/yyy`），讓 Worker 端的 OG meta 能對應到真實請求路徑，解鎖角色卡／企劃卡分享。

**Architecture:** 前端路由的「導覽引擎」（`navigate`/`href`/換頁監聽）從監聽 `hashchange` + 寫 `location.hash` 改成 History API（`pushState`/`replaceState` + 監聽 `popstate`）；App.tsx 既有的路徑解析邏輯（`seg.split('/')`）完全不用改，因為它本來就是吃一個乾淨的 `/a/b/c` 字串。Worker 端在既有的 `app.all('*', ...)` catch-all 裡加一層「真的存在的靜態檔案就直接回，其餘（SPA 路由）退回 index.html」的 fallback；既有的兩個 OG meta 專用路由（`/p/:slug`、`/p/:slug/c/:charId`）拿掉 hash 時代才需要的 meta-refresh 轉址，因為 path routing 下 JS 會在同一個網址原地接手，不用再彈去別的地方。

**Tech Stack:** React 19 + Vite（app/web，無自動化測試框架，用 `npx tsc --noEmit` + 手動驗證）、Hono on Cloudflare Workers + `@cloudflare/vitest-plugin`（app/api）。

**Spec:** `牽關-問題整理與工單.md` — `## P2 — 分享優先重構` → `### 第一步：hash routing 換成 path routing`（commit `96fd6bf` 版本）。

## Global Constraints

- **App.tsx 的路由解析邏輯（`seg = path.split('/').filter(Boolean)` 之後的一串 `if/else`）完全不動**——只有它吃到的 `path` 字串怎麼來的（hash vs pathname）要換，字串格式本身（一律以 `/` 開頭、不帶 `#`）不變。
- `href(path)` 的呼叫端簽名不變（各頁面／元件呼叫 `href('/p/xxx')` 的寫法完全不用改），只有它回傳的字串格式從 `#/xxx` 變成 `/xxx`。
- `navigate(path)` 的呼叫端簽名不變（Home.tsx/NewProject.tsx/Poster.tsx 三處）。
- 不引入 `react-router` 的實際路由功能（`<Routes>`/`<Route>`/`useNavigate` 等）——`package.json` 裡雖然有這個套件，但目前完全沒被使用（`main.tsx` 裡的 `<BrowserRouter>` 是包了但沒接任何東西的殘留），這次只拿掉這個沒用的包裹層，不用它的路由能力，繼續用既有的手刻路由（App.tsx 的 `seg` 判斷），這不是這次的重寫範圍。
- `checkLeave`／`subscribeLeaveGuard`／`getPendingPath`／`resolveLeave`（`dirty.ts`）這一組「編輯頁未儲存變更攔截跳出」的邏輯本身（判斷 dirty、彈 modal、三向選擇）**不變**，只有 `resolveLeave` 最後「真的換頁」那一行要換掉底層機制。
- Worker 端既有的 `/api/*` 路由、`securityHeaders`/`csrfGuard`/`rateLimitGuard` middleware、`servePage()` 的 OG meta 注入邏輯（`HeadRewriter` 類別、unlisted/not-found 分支只給通用 meta 的規則）**都不動**，只改 `redirect` 參數要不要傳。
- `og:image` 的預設值（`app/web/public/og-default.png`，已經是 1200×630 並已經接進 `index.html`）**不用重做**，這次不碰。

---

### Task 1: Worker 端 SPA-shell catch-all fallback

**Files:**
- Modify: `app/api/src/index.ts:425-429`（既有的 `app.all('*', ...)` catch-all）

**Interfaces:**
- Consumes: 既有的 `c.env.ASSETS`（Cloudflare Assets binding，`wrangler.jsonc` 已設定 `directory: "../web/dist"`）
- Produces: 任何非 `/api/*` 且不是真實靜態檔案的路徑都會拿到 `index.html`，讓前端路由（Task 3 換完之後）自己讀 `window.location.pathname` 接手。

這個 task 刻意先做、且完全不動前端——用 curl 就能驗證，跟 Task 3 的前端切換解耦，之後前端换完可以直接受益不用等。

- [ ] **Step 1: 修改 catch-all**

把 `app/api/src/index.ts` 第 425-429 行：

```ts
// 其餘一律交給靜態資產（SPA）
app.all('*', (c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: AUTH_FAIL }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});
```

改成：

```ts
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
```

- [ ] **Step 2: typecheck + 既有測試**

```bash
cd app/api
npm run typecheck
npx vitest run
```

Expected: 無新增錯誤（既有的 `Property 'X' does not exist on type 'Env'` 測試檔型別噪音不算，那是既有專案債，跟這次改動無關）。

- [ ] **Step 3: 本機起 Worker，手動驗證 fallback 行為**

```bash
cd app/web && npm run build
cd ../api
npm run dev
```

另開一個 terminal：

```bash
# 真實存在的靜態檔案：應該直接回 200 且是圖片內容，不是 index.html
curl -sI http://localhost:8787/favicon.svg | head -1

# 一個目前沒有對應實體檔案的 SPA 路由：狀態碼一定要是 200（不是 404），內容是 index.html（含 <div id="root">）
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/p/some-slug/manage
curl -s http://localhost:8787/p/some-slug/manage | grep -o '<div id="root">'

# POST 到一個不存在的路徑也要走同一條 fallback，不能因為帶了 method/body 就出錯或回錯東西
curl -s -o /dev/null -w '%{http_code}\n' -X POST -d '{}' http://localhost:8787/p/some-slug/manage

# API 路由不受影響，還是照舊 404 JSON
curl -s http://localhost:8787/api/not-a-real-route | head -c 100
```

Expected（依指令順序）：SVG 內容 → `200` → `<div id="root">`（代表 fallback 有生效，回的是 index.html）→ `200`（POST 帶 body 也要能正常過 fallback，不能出錯或回錯東西）→ JSON 格式的 `{"error":...}`。

- [ ] **Step 4: Commit**

```bash
git add app/api/src/index.ts
git commit -m "feat: fall back to index.html for unmatched non-API paths (SPA path routing support)"
```

---

### Task 2: `servePage()` 拿掉 hash 時代的 meta-refresh 轉址

**Files:**
- Modify: `app/api/src/index.ts:384-420`（`servePage()` 函式，被 `/p/:slug` 與 `/p/:slug/c/:charId` 兩條路由呼叫）

**Interfaces:**
- Consumes: 既有的 `HeadRewriter` 類別（`redirect: string | null` 建構子參數，`redirect` 為 `null` 時就不注入 `<meta http-equiv="refresh">`，這段邏輯本來就存在，不用改 `HeadRewriter` 本身）
- Produces: 無（純粹刪減行為，這個函式的呼叫端 `app.get('/p/:slug', ...)`／`app.get('/p/:slug/c/:charId', ...)` 簽名不變）

- [ ] **Step 1: 拿掉兩處 redirect 字串與其使用**

把 `app/api/src/index.ts` 第 390-400 行（`!p || p.visibility !== 'public'` 分支）：

```ts
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
```

改成：

```ts
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
```

（拿掉的是 `.on('head', new HeadRewriter(..., \`/#/p/...\`))` 那一行整個，因為那一行唯一的作用就是插入 meta-refresh 轉址，`title`/`meta` 的通用值已經由另外兩個 `.on()` 處理，不需要第三個。）

把第 412-419 行（公開企劃的正常分支）：

```ts
  const meta = { title, description, image };
  const redirect = `/#/p/${slug}${charId ? `/c/${charId}` : ''}`;
  return new HTMLRewriter()
    .on('title', new HeadRewriter(meta, null))
    .on('head', new HeadRewriter(meta, redirect))
    .on('meta', new HeadRewriter(meta, null))
    .transform(asset);
```

改成：

```ts
  const meta = { title, description, image };
  return new HTMLRewriter()
    .on('title', new HeadRewriter(meta, null))
    .on('meta', new HeadRewriter(meta, null))
    .transform(asset);
```

（同樣拿掉 `redirect` 變數與 `.on('head', ...)` 那一行；`title`/`meta` 兩個 `.on()` 保留，內容不變。）

- [ ] **Step 2: 在 `HeadRewriter` 建構子註記 `redirect` 現在沒有呼叫端在用**

Step 1 做完之後，`app/api/src/index.ts` 裡已經沒有任何地方會傳非 `null` 的 `redirect` 進 `HeadRewriter`，但這個參數本身留著（拿掉它要動到類別定義跟兩個呼叫點，多一次改動風險，不在這次範圍）。加一行註解避免下次有人以為它還有用。把第 350-354 行：

```ts
class HeadRewriter {
  constructor(
    private meta: { title: string; description: string; image: string | null },
    private redirect: string | null,
  ) {}
```

改成：

```ts
class HeadRewriter {
  constructor(
    private meta: { title: string; description: string; image: string | null },
    // path routing 上線後（見工單 P2 第一步）沒有任何呼叫端會傳非 null 進來了——
    // JS 會在同一個網址原地接手，不用再靠這裡轉址；留著這個參數但沒人用，之後若要整個拿掉
    // 要一併改 servePage() 的三個呼叫點。
    private redirect: string | null,
  ) {}
```

- [ ] **Step 3: typecheck + 既有測試**

```bash
cd app/api
npm run typecheck
npx vitest run
```

- [ ] **Step 4: 手動驗證 OG meta 還在，但不再轉址**

```bash
cd app/api
npm run dev
```

```bash
curl -s http://localhost:8787/p/some-slug | grep -E 'og:title|http-equiv=.refresh'
```

Expected：看得到 `og:title` 這行（meta 還在注入），**看不到** `http-equiv="refresh"` 這行（轉址已經拿掉）。

- [ ] **Step 5: Commit**

```bash
git add app/api/src/index.ts
git commit -m "fix: drop hash-era meta-refresh redirect from servePage (path routing hydrates in place)"
```

---

### Task 3: 前端路由引擎——hash 換成 History API

**Files:**
- Modify: `app/web/src/lib/dirty.ts`（新增 `commitNavigate`，改 `resolveLeave` 最後一行）
- Modify: `app/web/src/lib/nav.ts`（整份重寫：`navigate`/`href`/`useHashPath`→`usePathRoute`，新增 `installLinkNavigation` 取代 `dirty.ts` 原本的 `installClickGuard`）
- Modify: `app/web/src/App.tsx`（改用 `usePathRoute`，簡化 skip-link）
- Modify: `app/web/src/components/kg.tsx`（`LeaveGuardHost` 改呼叫 `installLinkNavigation`）

**Interfaces:**
- Consumes: 無新的外部依賴，純瀏覽器 History API（`pushState`/`replaceState`/`popstate` 事件）
- Produces:
  - `dirty.ts` 新增匯出：`commitNavigate(path: string, replace?: boolean): void`
  - `nav.ts` 匯出改變：`useHashPath` 改名為 `usePathRoute`（回傳型別不變：`{ path: string; isPending: boolean }`），新增 `installLinkNavigation(): () => void`（取代原本從 `dirty.ts` 匯出的 `installClickGuard`）；`navigate`/`href`/`parseSlugInput` 簽名不變

- [ ] **Step 1: `dirty.ts` 加 `commitNavigate`，改 `resolveLeave`**

Edit `app/web/src/lib/dirty.ts`，在 `checkLeave` 函式之前（第 60 行之前）加入：

```ts
/** 真的把網址換掉：pushState/replaceState 之後手動發一個 popstate 事件，讓所有訂閱者
 * （usePathRoute）統一走同一條「網址變了」的通知路徑——pushState()/replaceState() 本身
 * 不會觸發 popstate，只有瀏覽器上一頁/下一頁才會，這裡補上讓兩種來源行為一致。 */
export function commitNavigate(path: string, replace = false) {
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
```

把 `resolveLeave` 函式（第 94-112 行）裡的最後一行：

```ts
  pendingPath = null;
  guard = null;
  notify();
  location.hash = '#' + path;
}
```

改成：

```ts
  pendingPath = null;
  guard = null;
  notify();
  commitNavigate(path);
}
```

- [ ] **Step 2: 重寫 `nav.ts`**

把 `app/web/src/lib/nav.ts` 整份內容：

```ts
import { useEffect, useState, useTransition } from 'react';
import { checkLeave } from './dirty';
import { normSlug } from './tokens';

// Hash 路由：靜態預覽沒有伺服器 rewrite，全部走 #/ 路徑
export function navigate(path: string) {
  const p = path.startsWith('/') ? path : '/' + path;
  if (!checkLeave(p)) return; // 編輯頁有未儲存變更 → 攔截跳確認（規格 §12）
  window.location.hash = p;
}

// 1-2：換頁的 setState 包進 startTransition，isPending 拿去驅動頂部進度條（見 RouteProgress），
// 不再是固定時間的假動畫。用 useTransition 自己回傳的 start 函式才會反映在它自己的 isPending 上，
// 全域 startTransition 不會。
export function useHashPath(): { path: string; isPending: boolean } {
  const [path, setPath] = useState(() => window.location.hash.replace(/^#/, '') || '/');
  const [isPending, startPathTransition] = useTransition();
  useEffect(() => {
    const onChange = () => {
      const next = window.location.hash.replace(/^#/, '') || '/';
      startPathTransition(() => setPath(next));
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { path, isPending };
}

export function href(path: string) {
  return '#' + (path.startsWith('/') ? path : '/' + path);
}

// 從使用者貼上的連結或純企劃 ID 解析 slug（I/L/O 寬容映射，規格 §4.1）
export function parseSlugInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/\/p\/([a-z0-9][a-z0-9-]{1,60})/i);
  if (m) return normSlug(m[1]);
  if (/^[a-z0-9][a-z0-9-]{1,60}$/i.test(s)) return normSlug(s);
```

（檔案剩餘部分——`parseSlugInput` 結尾、`timeAgo` 等既有函式——照抄不動，只換上面這一段。）

改成：

```ts
import { useEffect, useState, useTransition } from 'react';
import { checkLeave, commitNavigate } from './dirty';
import { normSlug } from './tokens';

// Path routing：真實路徑，Worker 對非 /api/* 的路徑一律回 SPA shell（見 index.ts 的 catch-all）
export function navigate(path: string) {
  const p = path.startsWith('/') ? path : '/' + path;
  if (!checkLeave(p)) return; // 編輯頁有未儲存變更 → 攔截跳確認（規格 §12）
  commitNavigate(p);
}

// 1-2：換頁的 setState 包進 startTransition，isPending 拿去驅動頂部進度條（見 RouteProgress），
// 不再是固定時間的假動畫。監聽 popstate 同時涵蓋瀏覽器上一頁/下一頁跟 commitNavigate() 的手動事件。
export function usePathRoute(): { path: string; isPending: boolean } {
  const [path, setPath] = useState(() => window.location.pathname || '/');
  const [isPending, startPathTransition] = useTransition();
  useEffect(() => {
    const onChange = () => {
      const next = window.location.pathname || '/';
      startPathTransition(() => setPath(next));
    };
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { path, isPending };
}

export function href(path: string) {
  return path.startsWith('/') ? path : '/' + path;
}

/** 站內 <a href="/..."> 點擊時攔截成 client-side 導覽（不然瀏覽器會整頁重載）；
 * 取代原本掛在 dirty.ts 的 installClickGuard——path routing 下這支函式不只是「攔住 dirty 頁面」，
 * 還得真的完成導覽（pushState），職責變了所以搬過來。
 * 用 URL().origin 判斷是不是真的站內連結，不能只看開頭是不是 "/"——
 * "//example.com/foo" 這種協議相對網址也是以 "/" 開頭，字串前綴判斷會誤判成站內路徑，
 * 角色卡上的外部資料連結如果剛好是這個格式就會被攔下來導去一個不存在的站內路徑。 */
export function installLinkNavigation(): () => void {
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.rel.split(/\s+/).includes('external')) return;
    const raw = a.getAttribute('href') ?? '';
    // /api/... 是刻意要真的送到伺服器的（例如未來的第三方登入入口），不該被攔下來走前端路由
    if (!raw.startsWith('/') || raw.startsWith('/api/')) return;
    let url: URL;
    try {
      url = new URL(raw, window.location.origin);
    } catch {
      return;
    }
    if (url.origin !== window.location.origin) return; // "//other-host/..." 這類協議相對外部連結
    const path = url.pathname + url.search + url.hash;
    e.preventDefault();
    if (!checkLeave(path)) return; // 已經 preventDefault，攔下就留在原頁彈確認 modal
    commitNavigate(path);
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}

// 從使用者貼上的連結或純企劃 ID 解析 slug（I/L/O 寬容映射，規格 §4.1）
export function parseSlugInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/\/p\/([a-z0-9][a-z0-9-]{1,60})/i);
  if (m) return normSlug(m[1]);
  if (/^[a-z0-9][a-z0-9-]{1,60}$/i.test(s)) return normSlug(s);
```

（同樣，檔案剩餘部分不動，只換這一段。）

- [ ] **Step 3: `App.tsx` 改用 `usePathRoute`，簡化 skip-link**

Edit `app/web/src/App.tsx`，把：

```ts
import { useHashPath } from './lib/nav';
```

改成：

```ts
import { usePathRoute } from './lib/nav';
```

把：

```ts
  const { path, isPending } = useHashPath();
```

改成：

```ts
  const { path, isPending } = usePathRoute();
```

把 skip-link 那段（第 53-64 行）：

```tsx
      <a
        href="#main"
        className="kg-skiplink"
        onClick={(e) => {
          // hash 路由中 #main 會被當成路由，所以改用 JS 聚焦
          e.preventDefault();
          const el = document.getElementById('main');
          el?.focus();
          el?.scrollIntoView({ block: 'start' });
        }}
      >
        跳到主要內容
      </a>
```

改成：

```tsx
      <a href="#main" className="kg-skiplink">
        跳到主要內容
      </a>
```

（path routing 下 `#main` 是真的同頁錨點，`installLinkNavigation` 只在 `href` 以 `/` 開頭且同源時才攔截，`#main` 不符合條件不會被攔到，瀏覽器原生錨點跳轉 + `<main id="main" tabIndex={-1}>` 既有的 `tabIndex` 就足夠讓 focus 移過去，不用再自己攔截。）

- [ ] **Step 4: `kg.tsx` 的 `LeaveGuardHost` 改呼叫新函式**

Edit `app/web/src/components/kg.tsx`，把：

```ts
import { href } from '../lib/nav';
import { getPendingPath, installClickGuard, resolveLeave, subscribeLeaveGuard } from '../lib/dirty';
```

改成：

```ts
import { href, installLinkNavigation } from '../lib/nav';
import { getPendingPath, resolveLeave, subscribeLeaveGuard } from '../lib/dirty';
```

把：

```ts
  useEffect(() => installClickGuard(), []);
```

改成：

```ts
  useEffect(() => installLinkNavigation(), []);
```

- [ ] **Step 5: typecheck**

```bash
cd app/web
npx tsc --noEmit
```

Expected: 無錯誤。如果報 `installClickGuard`/`useHashPath` 找不到，代表有漏改的呼叫端——回頭 `grep -rn "useHashPath\|installClickGuard" app/web/src` 確認全部改完。

- [ ] **Step 6: 手動驗證（本機 dev server）**

```bash
cd app/api && npm run dev &
cd app/web && npm run build && cd ../api
```

（用 Task 1 已經驗證過的 `npm run dev` 走 Worker 直接服務 `web/dist`，這樣測到的行為才跟正式部署一致；純 `vite dev` 的開發伺服器有自己的 middleware，不會經過 Task 1/2 改的 Worker 邏輯。）

在瀏覽器打開 `http://localhost:8787/home`，確認：

1. 網址列真的是 `/home`，不是 `/#/home`。
2. 點站內任何連結（例如首頁的「建立企劃」），網址正確變化、頁面正確換到，且不是整頁重載（DevTools Network 面板應該只看到 API/資源請求，沒有重新載入 `index.html` 或 JS bundle）。
3. 按瀏覽器上一頁／下一頁，頁面正確跟著換。
4. 開一個編輯頁（例如角色編輯）故意留下未儲存變更，點站內另一個連結離開，應該跳出既有的「儲存並離開／捨棄離開／取消」三選一 modal，行為跟改動前一致。
5. cmd/ctrl+click 站內連結應該在新分頁打開，不應該被攔截。
6. **最關鍵的一項**：直接在網址列輸入一個深層路徑（例如 `http://localhost:8787/p/some-slug/manage`）按 Enter 直接進入，或是在任一頁按瀏覽器重新整理。這是分享連結真正會走的路徑——別人從 Discord 點連結進來，或使用者重新整理頁面，都是這個情境，只有這一項測得出 Task 1 的 fallback 是不是真的生效。Expected：頁面正常顯示對應內容，不是空白頁或 404。

- [ ] **Step 7: Commit**

```bash
git add app/web/src/lib/dirty.ts app/web/src/lib/nav.ts app/web/src/App.tsx app/web/src/components/kg.tsx
git commit -m "feat: switch frontend router from hash navigation to History API"
```

---

### Task 4: 拿掉沒用到的 `BrowserRouter`，加上舊 hash 連結相容重導

**Files:**
- Modify: `app/web/src/main.tsx`

**Interfaces:**
- Consumes: Task 3 完成後的 `usePathRoute`（讀 `window.location.pathname`）——這個 task 要確保進入 `usePathRoute` 的初始 `useState` 之前，舊 hash 連結已經被轉換成真實路徑。

- [ ] **Step 1: 拿掉沒用到的 `BrowserRouter`，加相容重導**

`app/web/src/main.tsx` 目前的內容是：

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

`<BrowserRouter>` 是 Vite 範本殘留，`App.tsx` 從來沒用過 `react-router` 的任何 hook 或元件（路由完全是自己手刻的 `usePathRoute`/`seg` 判斷），這裡只是包了一層沒有作用的殼。改成：

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// 相容舊的 /#/p/xxx 分享連結／書籤：讀到 hash 裡還留著舊路徑就轉成新路徑，
// 用 replaceState 不留歷史紀錄（避免使用者按上一頁又跳回帶 # 的舊網址）。
// 必須在 <App /> 掛載、usePathRoute() 第一次讀 window.location.pathname 之前跑完。
const oldHash = window.location.hash;
if (oldHash.startsWith('#/')) {
  window.history.replaceState(null, '', oldHash.slice(1) || '/');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

（`react-router` 這個套件本身留在 `package.json` 不動——移除沒用到的依賴是另一件事，不在這次範圍內，這裡只是不在程式碼裡用它。）

- [ ] **Step 2: typecheck**

```bash
cd app/web
npx tsc --noEmit
```

- [ ] **Step 3: 手動驗證舊連結相容**

```bash
cd app/api && npm run dev
```

在瀏覽器網址列直接貼 `http://localhost:8787/#/home` 打開。

Expected：網址列應該立刻變成 `http://localhost:8787/home`（`#` 不見了），頁面正確顯示首頁內容，不是空白或錯誤頁。按瀏覽器上一頁應該離開網站（不會停在帶 `#` 的舊網址），因為 `replaceState` 沒有留下那筆歷史紀錄。

- [ ] **Step 4: Commit**

```bash
git add app/web/src/main.tsx
git commit -m "chore: remove unused BrowserRouter wrapper, add hash-link compat redirect"
```

---

## 完成後的整體驗證清單

- [ ] `cd app/api && npm run typecheck && npx vitest run` 全綠（既有的 `Env` 型別噪音不算新問題）
- [ ] `cd app/web && npx tsc --noEmit` 全綠
- [ ] Task 1/2/3/4 各自的手動驗證步驟都跑過
- [ ] 把一個角色頁連結貼進 Discord／噗浪，展開出角色名與頭像的卡片（真正的驗收目標——這一步需要部署到正式網址 `https://qianguan.beibeiz.workers.dev` 才能測，因為 Discord/噗浪的爬蟲抓不到 `localhost`；部署前跟使用者確認一次，這會動到正式網址上所有既有分享出去的連結格式）
- [ ] 部署後打開一個先前分享過的舊 `/#/p/xxx` 連結（如果有的話），確認會被轉去新路徑而不是壞掉

**⚠️ 需要使用者動作**：整組驗證跑完、確認沒問題之後才 `cd app/api && npm run deploy`，這會讓正式網址上的路由行為整個換掉（雖然工單裡說「現在只有測試資料所以無所謂」，但這仍然是對外服務網址的路由行為變更，部署前跟使用者過一次目視結果）。
