# Discord 帳號整合（牽關）Implementation Plan

> **已作廢：v2 改為 Discord 登入為唯一身分**——這份計畫（含已執行到 Task 9/10 的實作）假設的是「權杖系統繼續存在、Discord 只是額外的選配連結方式」，跟後來定案的方向不是同一條路，對應的 worktree／分支已捨棄重來。留著是為了記住為什麼不走這條路，不是待執行的計畫。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓使用者用 Discord 帳號一次登入，看到自己所有企劃（開設者身分）與所有角色（含在別人企劃裡認領的角色）的清單，不用分別記住每個企劃/角色的編輯碼；貼碼救援永久保留，Discord 是額外選項。

**Architecture:** 新表 `user_links`（discord_id ↔ 企劃/角色的多對多關聯，`confirmed` 欄位區分「自動收錄」與「明確授權」）。四條流程：流程一（從已驗證頁面明確連結，`confirmed=1`）、流程二（既有五個 mutation 端點命中 `kg_u` 就自動收錄，`confirmed=0`）、流程三（新裝置用 Discord 登入，只還原 `confirmed=1` 的 cookie）、流程四（`/dashboard` 確認／解除連結）。完全不改動 `requireOwner`/`requireChar`/CSRF/速率限制/Turnstile；Discord 只是「怎麼拿到 cookie」多一種方法。

**Tech Stack:** Hono on Cloudflare Workers、D1 + Drizzle ORM、KV（`OAUTH_STATE`，一次性 state）、Web Crypto（HKDF + AES-256-GCM）、React 19 + Vite 前端。

**Spec:** `docs/superpowers/specs/2026-09-03-discord-account-linking-design.md`

## Global Constraints

- `requireOwner`/`requireChar`/`csrfGuard`/`rateLimitGuard`/`verifyTurnstile`：零修改。
- TokenGate 貼碼救援：完全不動，永久保留。
- `projects.owner_discord_id`/`characters.discord_id`（既有保留欄位）：不讀不寫，本功能不使用。
- `user_links` 只存 `discord_id`（Discord snowflake）。從 `/users/@me` 拿到的 username/avatar/discriminator **用完即丟，不寫進任何持久化儲存，不進 log**。
- `encrypted_token` 用 AES-256-GCM，金鑰是 HKDF 從 Workers secret `LINK_KEY` 衍生的兩把子金鑰之一：
  - 子金鑰 A（加密 token）：HKDF `info = "kg-link-enc-v1"`
  - 子金鑰 B（`kg_u` cookie 的 HMAC）：HKDF `info = "kg-u-hmac-v1"`
  - 兩個 `info` 字串是寫死常數，不可省略、不可共用同一個值。
- AES-GCM nonce：每次加密用 `crypto.getRandomValues()` 生新的 96-bit（12 bytes）隨機值，不可固定、不可從金鑰或明文推導。
- 索引不能用單一 `UNIQUE(discord_id, kind, project_id, char_id)`（NULL 不等於 NULL 擋不住重複 owner 連結），必須用兩條 partial unique index。
- `confirmed=0` 的列**只列在儀表板，不能在流程三（restore）解密／簽發任何 cookie**——這是取代「新鮮度窗口」的機制，不能退回時間窗口那個方向（會靜默失敗，且窗口長度是沒依據的魔術數字）。
- `GET /api/me/links` 回應形狀刻意收窄：每筆只有 `{ id, kind, confirmed, projectTitle, charName? }`，不 join 封面圖／簡介／世界觀等欄位，`confirmed=0` 和 `confirmed=1` 都適用同一套收窄規則。
- Callback 完成後轉址去哪裡，只能是後端從 KV 存的 `{mode, slug, charId}` 自己組出來的固定路徑（`/p/<slug>/manage`、`/p/<slug>/c/<charId>`、`/dashboard`），**不接受 callback request 上任何額外的轉址參數**。

**實作偏離規格原文的一處，先說明原因**：規格流程一步驟 5 寫「callback 重新驗證這個請求現在還帶著有效的 `kg_o_`/`kg_c_`」——但 `kg_o_<projectId>`/`kg_c_<projectId>` 的 cookie `Path=/api/p/<slug>`，而 Discord callback 落地在 `/api/auth/discord/callback`，不在這個 Path 前綴下，瀏覽器**不會**把這兩個 cookie 送到 callback 請求（這是瀏覽器 cookie Path 比對的硬限制，不是設計選擇）。同樣的限制也擋掉「在 `/api/auth/discord/login` 驗 cookie」這條路——那個路徑一樣不在 `/api/p/<slug>` 底下。

修正做法：把流程一的**發動端點改放在 `/api/p/:slug/discord-link`**（在既有 Path 前綴底下，cookie 會正常送到），在這裡直接重用 `requireOwner`/`requireChar`（零修改），驗證通過後把**此刻已經拿到的權杖明文**連同 `{mode:'link', slug, charId?, projectId}` 一起寫進 KV state（TTL 5 分鐘、一次性、伺服器端才讀得到，从未經過瀏覽器）。Callback 端不用也不能重新驗證 cookie，改成直接信任「這個 state_id 只有走過 `requireOwner`/`requireChar` 才可能被鑄造出來」這件事——安全性質不變（「連結永遠是已經驗證過身分之後才能發生的動作」），只是把驗證動作搬到 cookie Path 實際涵蓋的請求上。

---

### Task 1: D1 Schema + Migration（`user_links` 表）

**Files:**
- Modify: `app/api/src/db/schema.ts`
- Create: `app/api/drizzle/0002_user_links.sql`

**Interfaces:**
- Produces: `userLinks` table export，`UserLinkRow` type（`typeof userLinks.$inferSelect`）——後面所有 task 的 DB 存取都靠這個。

- [ ] **Step 1: 在 schema.ts 加 `userLinks` 表定義**

在 `app/api/src/db/schema.ts` 檔尾（`events` 表定義之後、`export type ProjectRow = ...` 之前）加入：

```ts
export const userLinks = sqliteTable(
  'user_links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    discordId: text('discord_id').notNull(),
    kind: text('kind').notNull(), // 'owner'|'char'
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    charId: text('char_id').references(() => characters.id), // 只有 kind='char' 有值
    encryptedToken: text('encrypted_token').notNull(), // AES-256-GCM 密文，見 auth/crypto.ts
    confirmed: integer('confirmed', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_links_discord').on(t.discordId),
    // NULL 不等於 NULL：owner 列的 char_id 是 NULL，單一組合索引擋不住重複連結，改用兩條 partial unique index
    uniqueIndex('idx_links_owner').on(t.discordId, t.projectId).where(sql`${t.kind} = 'owner'`),
    uniqueIndex('idx_links_char').on(t.discordId, t.charId).where(sql`${t.kind} = 'char'`),
  ],
);
```

並在檔尾的型別匯出區塊加一行：

```ts
export type UserLinkRow = typeof userLinks.$inferSelect;
```

- [ ] **Step 2: 寫對應的 raw SQL migration**

Create `app/api/drizzle/0002_user_links.sql`：

```sql
CREATE TABLE user_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  char_id TEXT REFERENCES characters(id),
  encrypted_token TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_links_discord ON user_links (discord_id);
CREATE UNIQUE INDEX idx_links_owner ON user_links (discord_id, project_id) WHERE kind = 'owner';
CREATE UNIQUE INDEX idx_links_char ON user_links (discord_id, char_id) WHERE kind = 'char';
```

- [ ] **Step 3: 本機套用 migration，跑一次既有測試確認沒壞掉**

```bash
cd app/api
npm run db:apply:local
npx vitest run
```

Expected: migration 套用成功（無錯誤），既有的 `character.test.ts`/`relation.test.ts` 全部 PASS（`apply-migrations.ts` 用 glob 抓 `drizzle/*.sql`，新檔案會自動被抓進測試環境，不用額外接線）。

- [ ] **Step 4: typecheck**

```bash
cd app/api
npm run typecheck
```

Expected: 無錯誤。

- [ ] **Step 5: Commit**

```bash
git add app/api/src/db/schema.ts app/api/drizzle/0002_user_links.sql
git commit -m "feat: add user_links table for Discord account linking"
```

**⚠️ 需要使用者動作**：這個 migration 之後要套到正式環境的 D1（`qianguan`），要跑 `npm run db:apply`（帶 `--remote`，動到真的 Cloudflare 帳號）。這一步先不執行，等 Task 7（第一個真的會寫入 `user_links` 的路由）要上線前再一起確認執行，避免正式庫裡有一張還沒有任何程式碼在用的空表格造成混淆。

---

### Task 2: 基礎設施 — KV Namespace + `LINK_KEY` Secret

**Files:**
- Modify: `app/api/wrangler.jsonc`
- Modify: `app/api/src/index.ts` (只改 `Bindings` type，不加路由)

**Interfaces:**
- Produces: `Bindings.OAUTH_STATE: KVNamespace`、`Bindings.LINK_KEY: string`、`Bindings.DISCORD_CLIENT_ID: string`、`Bindings.DISCORD_CLIENT_SECRET: string` ——後面每個要碰 Discord/KV/加密的 task 都靠這幾個型別。

**⚠️ 這個 task 大部分步驟需要使用者在真的 Cloudflare 帳號（`gigilai1688@gmail.com`）上執行，Claude 不能代為執行帳號層級操作。停在 Step 1 前先跟使用者確認要不要現在做。**

- [ ] **Step 1（使用者執行）：建立 KV namespace**

```bash
cd app/api
npx wrangler kv namespace create OAUTH_STATE
```

輸出會給一個 `id`（例如 `"a1b2c3d4..."`）。把這個 id 記下來，下一步要填進 `wrangler.jsonc`。

- [ ] **Step 2（使用者執行）：設定 `LINK_KEY` secret**

```bash
cd app/api
# 產生 32 bytes 隨機值當 secret（任何 32-byte 隨機字串都可以，這裡用 openssl 示範）
openssl rand -base64 32
npx wrangler secret put LINK_KEY
# 貼上一行上面產生的隨機字串
```

- [ ] **Step 3（使用者確認）：Discord Developer Portal 加 Redirect URI**

到 Discord Developer Portal → 這個應用程式 → OAuth2 → Redirects，加入：
- `https://qianguan.beibeiz.workers.dev/api/auth/discord/callback`（正式環境）
- `http://localhost:8787/api/auth/discord/callback`（本機 `wrangler dev` 測試用）

- [ ] **Step 4: 把 KV binding 寫進 wrangler.jsonc**

Edit `app/api/wrangler.jsonc`，在 `d1_databases` 之後、`ratelimits` 之前加入（把 `<id>` 換成 Step 1 拿到的真實 id）：

```jsonc
  "kv_namespaces": [
    { "binding": "OAUTH_STATE", "id": "<id>" }
  ],
```

- [ ] **Step 5: 更新 index.ts 的 Bindings type**

Edit `app/api/src/index.ts`，把：

```ts
type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  TURNSTILE_SECRET?: string;
  PUBLIC_SITE_NAME?: string;
};
```

改成：

```ts
type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  OAUTH_STATE: KVNamespace;
  TURNSTILE_SECRET?: string;
  PUBLIC_SITE_NAME?: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  LINK_KEY: string;
};
```

（`DISCORD_CLIENT_ID` 已經是 `wrangler.jsonc` 的 `vars`，`DISCORD_CLIENT_SECRET` 已經是既有 secret——這兩個上一輪就設定好了，這裡只是把型別補齊，不用重新申請或重新設定。）

- [ ] **Step 6: typecheck + 既有測試**

```bash
cd app/api
npm run typecheck
npx vitest run
```

Expected: 無錯誤（`KVNamespace` 是 `@cloudflare/workers-types` 內建的環境型別，不用額外 import）。

- [ ] **Step 7: Commit**

```bash
git add app/api/wrangler.jsonc app/api/src/index.ts
git commit -m "chore: wire OAUTH_STATE KV namespace and Discord/LINK_KEY bindings"
```

---

### Task 3: 加密輔助函式（`auth/crypto.ts`）

**Files:**
- Create: `app/api/src/auth/crypto.ts`
- Test: `app/api/src/auth/crypto.test.ts`

**Interfaces:**
- Consumes: 無（純函式，只依賴 Web Crypto API）
- Produces:
  - `encryptToken(secret: string, plaintext: string): Promise<string>`
  - `decryptToken(secret: string, encrypted: string): Promise<string | null>`
  - `hmacDiscordId(secret: string, discordId: string): Promise<string>`（Task 4 的 `kg_u` cookie 簽章要用）

- [ ] **Step 1: 寫失敗的測試**

Create `app/api/src/auth/crypto.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken, hmacDiscordId } from './crypto';

const SECRET = 'test-link-key-not-for-production-use-only';

describe('encryptToken / decryptToken', () => {
  it('加密後可以解回原文', async () => {
    const plaintext = 'own_abc123xyz';
    const encrypted = await encryptToken(SECRET, plaintext);
    expect(encrypted).not.toBe(plaintext);
    const decrypted = await decryptToken(SECRET, encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('同一段明文每次加密結果不同（nonce 隨機，不可重用）', async () => {
    const a = await encryptToken(SECRET, 'chr_same_input');
    const b = await encryptToken(SECRET, 'chr_same_input');
    expect(a).not.toBe(b);
  });

  it('金鑰不對解不出來，回傳 null（不丟例外）', async () => {
    const encrypted = await encryptToken(SECRET, 'own_xyz');
    const decrypted = await decryptToken('a-completely-different-secret-value', encrypted);
    expect(decrypted).toBeNull();
  });

  it('格式壞掉的密文回傳 null', async () => {
    expect(await decryptToken(SECRET, 'not-a-valid-ciphertext')).toBeNull();
  });
});

describe('hmacDiscordId', () => {
  it('同樣輸入同樣輸出（deterministic，cookie 驗證需要可重算）', async () => {
    const a = await hmacDiscordId(SECRET, '123456789012345678');
    const b = await hmacDiscordId(SECRET, '123456789012345678');
    expect(a).toBe(b);
  });

  it('不同 discordId 給不同 hmac', async () => {
    const a = await hmacDiscordId(SECRET, '111111111111111111');
    const b = await hmacDiscordId(SECRET, '222222222222222222');
    expect(a).not.toBe(b);
  });

  it('跟 encryptToken 用不同子金鑰——同一個 secret 底下，加密用途跟 HMAC 用途的衍生金鑰不同', async () => {
    // 間接驗證：把 hmac 輸出硬塞進 decryptToken 當密文解，必須失敗（格式不合法或解不出來）
    const hmac = await hmacDiscordId(SECRET, '333333333333333333');
    expect(await decryptToken(SECRET, hmac)).toBeNull();
  });
});
```

- [ ] **Step 2: 確認測試失敗（檔案還不存在）**

```bash
cd app/api
npx vitest run src/auth/crypto.test.ts
```

Expected: FAIL，`Cannot find module './crypto'`。

- [ ] **Step 3: 實作 crypto.ts**

Create `app/api/src/auth/crypto.ts`：

```ts
// auth/crypto.ts — Discord 連結權杖加密（規格「權杖加密」一節）
// 用 HKDF 從 LINK_KEY 衍生兩把子金鑰，info 字串是寫死常數，不可共用同一個值，
// 否則兩個用途會衍生出同一把金鑰，「分開用途」的意義就沒了。
const ENC_INFO = new TextEncoder().encode('kg-link-enc-v1');
const HMAC_INFO = new TextEncoder().encode('kg-u-hmac-v1');

async function importBaseKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey']);
}

async function deriveEncKey(secret: string): Promise<CryptoKey> {
  const base = await importBaseKey(secret);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: ENC_INFO },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function deriveHmacKey(secret: string): Promise<CryptoKey> {
  const base = await importBaseKey(secret);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: HMAC_INFO },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  );
}

function toB64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** AES-256-GCM 加密；nonce 每次 crypto.getRandomValues() 重新產生，格式：base64url(nonce):base64url(ciphertext) */
export async function encryptToken(secret: string, plaintext: string): Promise<string> {
  const key = await deriveEncKey(secret);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(plaintext));
  return `${toB64url(nonce)}:${toB64url(new Uint8Array(ct))}`;
}

export async function decryptToken(secret: string, encrypted: string): Promise<string | null> {
  const [nonceB64, ctB64] = encrypted.split(':');
  if (!nonceB64 || !ctB64) return null;
  try {
    const key = await deriveEncKey(secret);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(nonceB64) }, key, fromB64url(ctB64));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/** kg_u cookie 簽章：HMAC-SHA256(discordId)，防止使用者竄改 cookie 裡的 discord_id */
export async function hmacDiscordId(secret: string, discordId: string): Promise<string> {
  const key = await deriveHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(discordId));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: 確認測試通過**

```bash
cd app/api
npx vitest run src/auth/crypto.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 5: typecheck**

```bash
cd app/api
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add app/api/src/auth/crypto.ts app/api/src/auth/crypto.test.ts
git commit -m "feat: add HKDF+AES-GCM crypto helpers for Discord link tokens"
```

---

### Task 4: `kg_u` Cookie 輔助函式（`guard.ts` 新增）

**Files:**
- Modify: `app/api/src/auth/guard.ts`
- Test: `app/api/src/auth/guard.test.ts` (新檔案)

**Interfaces:**
- Consumes: `hmacDiscordId` from Task 3 (`./crypto`)
- Produces:
  - `kgUCookieLine(secret: string, discordId: string): Promise<string>`
  - `verifyKgU(secret: string, cookieHeader: string | undefined): Promise<string | null>`
  - `charCookieLineFromTokens(slug: string, projectId: string, tokens: string[]): string`（Task 7 的流程三 restore 要用，一次組合多隻角色權杖成一個 cookie，避免對每個權杖各自 append 同名 `Set-Cookie` 導致瀏覽器只留其中一個）

- [ ] **Step 1: 寫失敗的測試**

Create `app/api/src/auth/guard.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { charCookieLineFromTokens, kgUCookieLine, verifyKgU } from './guard';

const SECRET = 'test-link-key-not-for-production-use-only';

describe('kgUCookieLine / verifyKgU', () => {
  it('簽出來的 cookie 驗得回同一個 discordId', async () => {
    const line = await kgUCookieLine(SECRET, '123456789012345678');
    const cookieHeader = line.split(';')[0]; // 只取 "kg_u=xxx" 這段模擬瀏覽器送回來的 Cookie header
    expect(await verifyKgU(SECRET, cookieHeader)).toBe('123456789012345678');
  });

  it('cookie 屬性正確：HttpOnly/Secure/SameSite=Lax/Path=/api', async () => {
    const line = await kgUCookieLine(SECRET, '111111111111111111');
    expect(line).toContain('HttpOnly');
    expect(line).toContain('Secure');
    expect(line).toContain('SameSite=Lax');
    expect(line).toContain('Path=/api');
  });

  it('被竄改 discordId 但沒重算 hmac 的 cookie 驗證失敗', async () => {
    const line = await kgUCookieLine(SECRET, '111111111111111111');
    const [, hmac] = line.split(';')[0].replace('kg_u=', '').split('.');
    const forged = `kg_u=999999999999999999.${hmac}`;
    expect(await verifyKgU(SECRET, forged)).toBeNull();
  });

  it('沒有 kg_u cookie 回傳 null', async () => {
    expect(await verifyKgU(SECRET, 'other_cookie=abc')).toBeNull();
    expect(await verifyKgU(SECRET, undefined)).toBeNull();
  });
});

describe('charCookieLineFromTokens', () => {
  it('多個權杖用 . 接成一個 cookie 值', () => {
    const line = charCookieLineFromTokens('my-slug', 'prj_abc', ['chr_one', 'chr_two']);
    expect(line).toContain('kg_c_prj_abc=chr_one.chr_two');
    expect(line).toContain('Path=/api/p/my-slug');
  });
});
```

- [ ] **Step 2: 確認測試失敗**

```bash
cd app/api
npx vitest run src/auth/guard.test.ts
```

Expected: FAIL，`kgUCookieLine`/`verifyKgU`/`charCookieLineFromTokens` 不存在。

- [ ] **Step 3: 在 guard.ts 加上這三個函式**

Edit `app/api/src/auth/guard.ts`，先在檔案頂端加 import：

```ts
import { hmacDiscordId } from './crypto';
```

（原本只有 `import { sha256hex } from './token';`，改成兩行 import。）

然後在 `resolveToken` 函式之後（檔尾）加入：

```ts
/** 流程三 restore：一次把同企劃底下所有角色權杖組成一個 kg_c_ cookie——
 * 不能對每個權杖各自呼叫 charCookieLine() 各自 append，同名 cookie 瀏覽器只會留其中一個，其餘角色的權杖會遺失。 */
export function charCookieLineFromTokens(slug: string, projectId: string, tokens: string[]): string {
  return cookieLine(`kg_c_${projectId}`, tokens.join('.'), slug);
}

/** kg_u：<discord_id>.<hmac_hex>，Path=/api（不像 kg_o_/kg_c_ 綁定單一企劃，這是全站身分） */
export async function kgUCookieLine(secret: string, discordId: string): Promise<string> {
  const hmac = await hmacDiscordId(secret, discordId);
  return `kg_u=${discordId}.${hmac}; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=${COOKIE_MAX_AGE}`;
}

/** 驗 kg_u 的 HMAC，不合法（缺失／格式錯／簽章不符）一律回 null，等同沒有這個 cookie */
export async function verifyKgU(secret: string, cookieHeader: string | undefined): Promise<string | null> {
  const v = readCookieFrom(cookieHeader, 'kg_u');
  if (!v) return null;
  const dot = v.indexOf('.');
  if (dot < 0) return null;
  const discordId = v.slice(0, dot);
  const hmac = v.slice(dot + 1);
  if (!discordId || !hmac) return null;
  return (await hmacDiscordId(secret, discordId)) === hmac ? discordId : null;
}
```

- [ ] **Step 4: 確認測試通過**

```bash
cd app/api
npx vitest run src/auth/guard.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 5: 既有測試 + typecheck**

```bash
cd app/api
npx vitest run
npm run typecheck
```

Expected: 全部 PASS（沒動到既有函式，只是新增）。

- [ ] **Step 6: Commit**

```bash
git add app/api/src/auth/guard.ts app/api/src/auth/guard.test.ts
git commit -m "feat: add kg_u cookie helpers and multi-token cookie merge for restore flow"
```

---

### Task 5: `user_links` Service 層（`services/discordLinks.ts`）

**Files:**
- Create: `app/api/src/services/discordLinks.ts`
- Test: `app/api/src/services/discordLinks.test.ts`

**Interfaces:**
- Consumes: `userLinks`, `projects`, `characters` from `../db/schema`；`encryptToken`/`decryptToken` from `../auth/crypto`
- Produces（Task 7/9/10 都直接呼叫這些）:
  - `interface AutoLinkTarget { kind: 'owner' | 'char'; projectId: string; charId?: string; label: string }`
  - `interface RestoreRow { kind: 'owner' | 'char'; projectId: string; charId: string | null; rawToken: string }`
  - `interface LinkSummary { id: number; kind: 'owner' | 'char'; confirmed: boolean; projectTitle: string; charName?: string }`
  - `autoLink(d, discordId, target, rawToken, linkKey): Promise<{ id: number; label: string } | null>`（流程二）
  - `upsertConfirmedLink(d, discordId, target, rawToken, linkKey): Promise<void>`（流程一）
  - `confirmedLinksFor(d, discordId, linkKey): Promise<RestoreRow[]>`（流程三）
  - `listLinksFor(d, discordId): Promise<LinkSummary[]>`（流程四）
  - `setConfirmed(d, discordId, linkId, confirmed): Promise<boolean>`（流程四 confirm/unconfirm）
  - `deleteLink(d, discordId, linkId): Promise<boolean>`（流程四 delete）

- [ ] **Step 1: 寫失敗的測試**

Create `app/api/src/services/discordLinks.test.ts`：

```ts
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { beforeEach, describe, expect, it } from 'vitest';
import { characters, projects } from '../db/schema';
import * as links from './discordLinks';

const db = drizzle(env.DB);
const LINK_KEY = 'test-link-key-not-for-production-use-only';

let projectId: string;
let slug: string;
let charId: string;

beforeEach(async () => {
  projectId = `prj_test_${crypto.randomUUID().slice(0, 8)}`;
  slug = `slug-${projectId}`;
  charId = `chr_test_${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();
  await db.insert(projects).values({ id: projectId, slug, title: '測試企劃', ownerTokenHash: 'x', createdAt: now, updatedAt: now });
  await db.insert(characters).values({
    id: charId, projectId, name: '測試角色', status: 'active', editTokenHash: 'y', createdAt: now, updatedAt: now,
  });
});

describe('autoLink（流程二：自動收錄，永遠 confirmed=0）', () => {
  it('第一次收錄成功，回傳新列的 id 跟 label', async () => {
    const r = await links.autoLink(db, 'discord-1', { kind: 'owner', projectId, label: '測試企劃' }, 'own_raw_token', LINK_KEY);
    expect(r).not.toBeNull();
    expect(r!.label).toBe('測試企劃');
  });

  it('同一個 discordId 對同一個目標再收錄一次，什麼都不做（回傳 null，不重複插入）', async () => {
    await links.autoLink(db, 'discord-1', { kind: 'owner', projectId, label: '測試企劃' }, 'own_raw_token', LINK_KEY);
    const r2 = await links.autoLink(db, 'discord-1', { kind: 'owner', projectId, label: '測試企劃' }, 'own_raw_token_2', LINK_KEY);
    expect(r2).toBeNull();
  });

  it('不同 discordId 已經連過同一個目標，第二個 discordId 收錄直接跳過（共用電腦防護）', async () => {
    await links.autoLink(db, 'discord-A', { kind: 'char', projectId, charId, label: '測試角色' }, 'chr_raw_a', LINK_KEY);
    const r = await links.autoLink(db, 'discord-B', { kind: 'char', projectId, charId, label: '測試角色' }, 'chr_raw_b', LINK_KEY);
    expect(r).toBeNull();
  });

  it('不會把已確認的列降級——upsertConfirmedLink 過的列，autoLink 再打一次不影響 confirmed', async () => {
    await links.upsertConfirmedLink(db, 'discord-1', { kind: 'owner', projectId, label: '測試企劃' }, 'own_raw', LINK_KEY);
    await links.autoLink(db, 'discord-1', { kind: 'owner', projectId, label: '測試企劃' }, 'own_raw_2', LINK_KEY);
    const rows = await links.listLinksFor(db, 'discord-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].confirmed).toBe(true);
  });
});

describe('upsertConfirmedLink（流程一：明確連結，永遠 confirmed=1）', () => {
  it('新增一列且 confirmed=1', async () => {
    await links.upsertConfirmedLink(db, 'discord-1', { kind: 'char', projectId, charId, label: '測試角色' }, 'chr_raw', LINK_KEY);
    const rows = await links.listLinksFor(db, 'discord-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].confirmed).toBe(true);
    expect(rows[0].charName).toBe('測試角色');
  });

  it('對同一個 discordId+目標再次呼叫是更新既有列，不是新增第二列', async () => {
    await links.upsertConfirmedLink(db, 'discord-1', { kind: 'owner', projectId, label: '測試企劃' }, 'own_raw_1', LINK_KEY);
    await links.upsertConfirmedLink(db, 'discord-1', { kind: 'owner', projectId, label: '測試企劃' }, 'own_raw_2', LINK_KEY);
    const rows = await links.listLinksFor(db, 'discord-1');
    expect(rows).toHaveLength(1);
  });
});

describe('confirmedLinksFor（流程三：restore，只還原 confirmed=1）', () => {
  it('只回傳 confirmed=1 的列，且能解密回原始權杖', async () => {
    await links.upsertConfirmedLink(db, 'discord-1', { kind: 'owner', projectId, label: '測試企劃' }, 'own_confirmed_raw', LINK_KEY);
    await links.autoLink(db, 'discord-1', { kind: 'char', projectId, charId, label: '測試角色' }, 'chr_pending_raw', LINK_KEY);
    const rows = await links.confirmedLinksFor(db, 'discord-1', LINK_KEY);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('owner');
    expect(rows[0].rawToken).toBe('own_confirmed_raw');
  });

  it('沒有任何 confirmed=1 的列時回傳空陣列', async () => {
    await links.autoLink(db, 'discord-1', { kind: 'owner', projectId, label: '測試企劃' }, 'own_raw', LINK_KEY);
    expect(await links.confirmedLinksFor(db, 'discord-1', LINK_KEY)).toEqual([]);
  });
});

describe('listLinksFor（流程四：儀表板，回應形狀收窄）', () => {
  it('只回傳 id/kind/confirmed/projectTitle/charName，不帶封面／簡介等欄位', async () => {
    await links.upsertConfirmedLink(db, 'discord-1', { kind: 'owner', projectId, label: '測試企劃' }, 'own_raw', LINK_KEY);
    const rows = await links.listLinksFor(db, 'discord-1');
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(['charName', 'confirmed', 'id', 'kind', 'projectTitle'].sort());
  });
});

describe('setConfirmed / deleteLink（流程四：confirm/unconfirm/delete，都要驗 discordId 相符）', () => {
  it('setConfirmed 對得上 discordId 才會成功', async () => {
    const added = await links.autoLink(db, 'discord-1', { kind: 'owner', projectId, label: '測試企劃' }, 'own_raw', LINK_KEY);
    expect(await links.setConfirmed(db, 'discord-2', added!.id, true)).toBe(false); // discordId 不符
    expect(await links.setConfirmed(db, 'discord-1', added!.id, true)).toBe(true);
    const rows = await links.listLinksFor(db, 'discord-1');
    expect(rows[0].confirmed).toBe(true);
  });

  it('setConfirmed 可以降回 unconfirm（反悔路徑）', async () => {
    const added = await links.autoLink(db, 'discord-1', { kind: 'owner', projectId, label: '測試企劃' }, 'own_raw', LINK_KEY);
    await links.setConfirmed(db, 'discord-1', added!.id, true);
    await links.setConfirmed(db, 'discord-1', added!.id, false);
    const rows = await links.listLinksFor(db, 'discord-1');
    expect(rows[0].confirmed).toBe(false);
  });

  it('deleteLink 對得上 discordId 才會成功，成功後那列真的消失', async () => {
    const added = await links.autoLink(db, 'discord-1', { kind: 'owner', projectId, label: '測試企劃' }, 'own_raw', LINK_KEY);
    expect(await links.deleteLink(db, 'discord-2', added!.id)).toBe(false);
    expect(await links.deleteLink(db, 'discord-1', added!.id)).toBe(true);
    expect(await links.listLinksFor(db, 'discord-1')).toEqual([]);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

```bash
cd app/api
npx vitest run src/services/discordLinks.test.ts
```

Expected: FAIL，`./discordLinks` 模組不存在。

- [ ] **Step 3: 實作 discordLinks.ts**

Create `app/api/src/services/discordLinks.ts`：

```ts
// services/discordLinks.ts — user_links 表的存取層（規格 §資料模型／流程一～四）
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { characters, projects, userLinks } from '../db/schema';
import { decryptToken, encryptToken } from '../auth/crypto';

type DB = DrizzleD1Database;

export interface AutoLinkTarget {
  kind: 'owner' | 'char';
  projectId: string;
  charId?: string;
  label: string; // 給 toast／儀表板顯示用的人類可讀名稱
}

export interface RestoreRow {
  kind: 'owner' | 'char';
  projectId: string;
  charId: string | null;
  rawToken: string;
}

export interface LinkSummary {
  id: number;
  kind: 'owner' | 'char';
  confirmed: boolean;
  projectTitle: string;
  charName?: string;
}

async function findExisting(d: DB, discordId: string | null, target: AutoLinkTarget) {
  const base = discordId
    ? and(eq(userLinks.discordId, discordId), eq(userLinks.kind, target.kind))
    : eq(userLinks.kind, target.kind);
  const scoped = target.kind === 'owner'
    ? and(base, eq(userLinks.projectId, target.projectId))
    : and(base, eq(userLinks.charId, target.charId!));
  return d.select({ id: userLinks.id }).from(userLinks).where(scoped).limit(1);
}

/** 流程二：登入後自動收錄。任何一種既有列（不管是哪個 discordId、不管 confirmed 是 0 還是 1）都代表
 * 這個目標已經被收錄過，直接跳過不動；只有完全沒有既有列時才新增一列，永遠 confirmed=0。 */
export async function autoLink(
  d: DB,
  discordId: string,
  target: AutoLinkTarget,
  rawToken: string,
  linkKey: string,
): Promise<{ id: number; label: string } | null> {
  const existing = await findExisting(d, null, target);
  if (existing.length > 0) return null;

  const encryptedToken = await encryptToken(linkKey, rawToken);
  const inserted = await d.insert(userLinks).values({
    discordId,
    kind: target.kind,
    projectId: target.projectId,
    charId: target.charId ?? null,
    encryptedToken,
    confirmed: false,
    createdAt: Date.now(),
  }).returning({ id: userLinks.id });
  return { id: inserted[0].id, label: target.label };
}

/** 流程一：明確 OAuth 連結，永遠 confirmed=1。對這個 discordId 已有列就更新（換新的 encrypted_token、確認狀態），
 * 沒有就新增——不影響其他 discordId 對同一個目標的列（一個企劃允許多個 Discord 帳號各自連結，規格 v1 排除範圍裡的
 * 「共同管理者」功能，資料結構上已經支援，只是還沒做邀請 UI）。 */
export async function upsertConfirmedLink(
  d: DB,
  discordId: string,
  target: AutoLinkTarget,
  rawToken: string,
  linkKey: string,
): Promise<void> {
  const encryptedToken = await encryptToken(linkKey, rawToken);
  const existing = await findExisting(d, discordId, target);
  if (existing.length > 0) {
    await d.update(userLinks).set({ encryptedToken, confirmed: true }).where(eq(userLinks.id, existing[0].id));
    return;
  }
  await d.insert(userLinks).values({
    discordId,
    kind: target.kind,
    projectId: target.projectId,
    charId: target.charId ?? null,
    encryptedToken,
    confirmed: true,
    createdAt: Date.now(),
  });
}

/** 流程三：restore，只處理 confirmed=1 的列——confirmed=0 的待確認列不解密、不回傳。 */
export async function confirmedLinksFor(d: DB, discordId: string, linkKey: string): Promise<RestoreRow[]> {
  const rows = await d.select().from(userLinks).where(and(eq(userLinks.discordId, discordId), eq(userLinks.confirmed, true)));
  const out: RestoreRow[] = [];
  for (const r of rows) {
    const raw = await decryptToken(linkKey, r.encryptedToken);
    if (raw) out.push({ kind: r.kind as 'owner' | 'char', projectId: r.projectId, charId: r.charId, rawToken: raw });
  }
  return out;
}

/** 流程四：儀表板列表。回應形狀刻意收窄——不 join 封面圖／簡介／世界觀，
 * confirmed=0 的項目可能是別人的東西被共用電腦誤收錄，這條規則對 confirmed=0/1 都適用。 */
export async function listLinksFor(d: DB, discordId: string): Promise<LinkSummary[]> {
  const rows = await d
    .select({
      id: userLinks.id,
      kind: userLinks.kind,
      confirmed: userLinks.confirmed,
      projectTitle: projects.title,
      charName: characters.name,
    })
    .from(userLinks)
    .innerJoin(projects, eq(userLinks.projectId, projects.id))
    .leftJoin(characters, eq(userLinks.charId, characters.id))
    .where(eq(userLinks.discordId, discordId));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as 'owner' | 'char',
    confirmed: r.confirmed,
    projectTitle: r.projectTitle,
    charName: r.charName ?? undefined,
  }));
}

/** 流程四 confirm/unconfirm 共用：驗 discordId 相符才能改，冪等。回傳是否成功（給路由層當 404 判斷）。 */
export async function setConfirmed(d: DB, discordId: string, linkId: number, confirmed: boolean): Promise<boolean> {
  const rows = await d.select({ id: userLinks.id }).from(userLinks)
    .where(and(eq(userLinks.id, linkId), eq(userLinks.discordId, discordId))).limit(1);
  if (!rows.length) return false;
  await d.update(userLinks).set({ confirmed }).where(eq(userLinks.id, linkId));
  return true;
}

/** 流程四 delete：驗 discordId 相符才能刪，不透露列存在與否（不符一律當「找不到」）。 */
export async function deleteLink(d: DB, discordId: string, linkId: number): Promise<boolean> {
  const rows = await d.select({ id: userLinks.id }).from(userLinks)
    .where(and(eq(userLinks.id, linkId), eq(userLinks.discordId, discordId))).limit(1);
  if (!rows.length) return false;
  await d.delete(userLinks).where(eq(userLinks.id, linkId));
  return true;
}
```

- [ ] **Step 4: 確認測試通過**

```bash
cd app/api
npx vitest run src/services/discordLinks.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 5: 既有測試 + typecheck**

```bash
cd app/api
npx vitest run
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add app/api/src/services/discordLinks.ts app/api/src/services/discordLinks.test.ts
git commit -m "feat: add user_links service layer (autoLink/upsertConfirmedLink/restore/dashboard)"
```

---

### Task 6: OAuth State（KV）+ Discord API 整合

**Files:**
- Create: `app/api/src/auth/oauthState.ts`
- Test: `app/api/src/auth/oauthState.test.ts`
- Create: `app/api/src/discordOAuth.ts`（不寫測試——跟既有 `turnstile.ts` 同類型的外部 HTTP 呼叫，這個 codebase 對這類檔案的既有慣例是不寫單元測試，靠 Task 7 的手動驗證覆蓋）

**Interfaces:**
- Produces:
  - `interface OAuthState = { mode: 'link'; slug: string; charId?: string; projectId: string; rawToken: string } | { mode: 'restore' }`
  - `createState(kv: KVNamespace, state: OAuthState): Promise<string>`
  - `consumeState(kv: KVNamespace, id: string): Promise<OAuthState | null>`
  - `buildAuthorizeUrl(clientId: string, redirectUri: string, state: string): string`
  - `exchangeCode(clientId: string, clientSecret: string, redirectUri: string, code: string): Promise<string | null>`
  - `fetchDiscordId(accessToken: string): Promise<string | null>`

- [ ] **Step 1: 寫失敗的測試（oauthState.ts）**

Create `app/api/src/auth/oauthState.test.ts`：

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { consumeState, createState } from './oauthState';

describe('createState / consumeState', () => {
  it('寫入後可以讀回一樣的內容', async () => {
    const id = await createState(env.OAUTH_STATE, { mode: 'link', slug: 'my-slug', projectId: 'prj_x', rawToken: 'own_raw' });
    const got = await consumeState(env.OAUTH_STATE, id);
    expect(got).toEqual({ mode: 'link', slug: 'my-slug', projectId: 'prj_x', rawToken: 'own_raw' });
  });

  it('一次性：讀過一次之後同一個 id 再讀不到', async () => {
    const id = await createState(env.OAUTH_STATE, { mode: 'restore' });
    await consumeState(env.OAUTH_STATE, id);
    expect(await consumeState(env.OAUTH_STATE, id)).toBeNull();
  });

  it('沒被 createState 寫過的 id 讀不到（等同無法偽造）', async () => {
    expect(await consumeState(env.OAUTH_STATE, 'not-a-real-state-id')).toBeNull();
  });
});
```

- [ ] **Step 2: 確認測試失敗**

```bash
cd app/api
npx vitest run src/auth/oauthState.test.ts
```

Expected: FAIL，模組不存在（若還沒做 Task 2 的 `OAUTH_STATE` KV binding，這裡也會因為 `env.OAUTH_STATE` undefined 而失敗——Task 2 必須先完成）。

- [ ] **Step 3: 實作 oauthState.ts**

Create `app/api/src/auth/oauthState.ts`：

```ts
// auth/oauthState.ts — Discord OAuth state：KV 一次性 token，同時滿足「不可偽造」跟「一次性」
// （規格「state 防護」一節）。不可偽造靠 state_id 本身是高熵 CSPRNG，沒被寫進 KV 的值查不到；
// 一次性靠讀到就刪，TTL 5 分鐘只是保險不是主要防線。
export type OAuthState =
  | { mode: 'link'; slug: string; charId?: string; projectId: string; rawToken: string }
  | { mode: 'restore' };

const KEY_PREFIX = 'oauth:';

export async function createState(kv: KVNamespace, state: OAuthState): Promise<string> {
  const id = crypto.randomUUID();
  await kv.put(KEY_PREFIX + id, JSON.stringify(state), { expirationTtl: 300 });
  return id;
}

export async function consumeState(kv: KVNamespace, id: string): Promise<OAuthState | null> {
  const key = KEY_PREFIX + id;
  const raw = await kv.get(key);
  if (!raw) return null;
  await kv.delete(key);
  return JSON.parse(raw) as OAuthState;
}
```

- [ ] **Step 4: 確認測試通過**

```bash
cd app/api
npx vitest run src/auth/oauthState.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 5: 實作 discordOAuth.ts（不寫測試，見上方說明）**

Create `app/api/src/discordOAuth.ts`：

```ts
// discordOAuth.ts — Discord OAuth2 token 交換 + 身分查詢，伺服器對伺服器呼叫。
// 只取 discord_id 一個欄位（規格「隱私」一節）：username/avatar 等其他欄位不讀、不存。
const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const ME_URL = 'https://discord.com/api/users/@me';

export function buildAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'identify');
  u.searchParams.set('state', state);
  return u.toString();
}

export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string,
): Promise<string | null> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

export async function fetchDiscordId(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(ME_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string };
    return data.id ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: 既有測試 + typecheck**

```bash
cd app/api
npx vitest run
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add app/api/src/auth/oauthState.ts app/api/src/auth/oauthState.test.ts app/api/src/discordOAuth.ts
git commit -m "feat: add OAuth state KV helper and Discord token/identity exchange"
```

---

### Task 7: Flow 1 + Flow 3 路由（登入 / 連結 / callback）

**Files:**
- Modify: `app/api/src/index.ts`

**Interfaces:**
- Consumes: `discordLinksSvc.upsertConfirmedLink/confirmedLinksFor` (Task 5), `oauthState.createState/consumeState` (Task 6), `discordOAuth.buildAuthorizeUrl/exchangeCode/fetchDiscordId` (Task 6), `kgUCookieLine/charCookieLineFromTokens` (Task 4), 既有 `requireOwner`/`requireChar`/`ownerCookieLine`/`charTokens`/`ownerToken`/`sha256hex`（零修改，直接重用）
- Produces: 三個新路由，Task 9/10 之後的 Flow 2/4 路由會加在同一個檔案裡

這個 codebase 目前只對 service 層寫單元測試（`character.test.ts`/`relation.test.ts`），路由層没有既有測試慣例——這個 task 用手動 curl／瀏覽器驗證，不新增路由層測試檔案，維持既有慣例一致。

- [ ] **Step 1: import 新模組**

Edit `app/api/src/index.ts`，在既有的 import 區塊加入：

```ts
import { charCookieLineFromTokens, kgUCookieLine, ownerCookieLine, verifyKgU } from './auth/guard';
import * as oauthState from './auth/oauthState';
import * as discordOAuth from './discordOAuth';
import * as discordLinksSvc from './services/discordLinks';
```

（注意：`ownerCookieLine` 原本沒被 index.ts import 過，這裡是新增；`charTokens`/`ownerToken` 已經在既有 import 裡。）

- [ ] **Step 2: 加入 `/api/p/:slug/discord-link`（流程一發動端點）**

在 `app.get('/api/p/:slug/roster', ...)` 之後（開設者區塊內，因為這條路由同時服務 owner 跟 char 兩種模式，放在角色區塊之前的過渡位置）加入：

```ts
// ================= Discord 帳號整合 =================

// 流程一發動端點：刻意放在 /api/p/:slug 底下（不是 /api/auth/...），
// 因為 kg_o_/kg_c_ cookie 的 Path=/api/p/<slug>，只有這個前綴下的請求瀏覽器才會送 cookie。
// requireOwner/requireChar 零修改直接重用；驗證通過後把「此刻已經拿到的權杖明文」寫進 KV state，
// 讓 callback 不用（也不能，Path 不涵蓋）重新驗證 cookie。
app.get('/api/p/:slug/discord-link', async (c) => {
  const d = db(c);
  const slug = c.req.param('slug');
  const charId = c.req.query('charId');
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const { success } = await c.env.RATE_LIMITER.limit({ key: `discord-link:${ip}` });
  if (!success) return c.json({ error: '操作太頻繁，請稍後再試' }, 429);

  let projectId: string;
  let rawToken: string | null = null;
  if (charId) {
    const got = await requireChar(d, slug, charId, cookieOf(c));
    if (!got) return c.json({ error: AUTH_FAIL }, 401);
    projectId = got.project.id;
    for (const t of charTokens(cookieOf(c), got.project.id)) {
      if ((await sha256hex(t)) === got.character.editTokenHash) { rawToken = t; break; }
    }
  } else {
    const p = await requireOwner(d, slug, cookieOf(c));
    if (!p) return c.json({ error: AUTH_FAIL }, 401);
    projectId = p.id;
    rawToken = ownerToken(cookieOf(c), p.id);
  }
  if (!rawToken) return c.json({ error: AUTH_FAIL }, 401);

  const stateId = await oauthState.createState(c.env.OAUTH_STATE, { mode: 'link', slug, charId: charId || undefined, projectId, rawToken });
  const redirectUri = new URL('/api/auth/discord/callback', c.req.url).toString();
  return c.redirect(discordOAuth.buildAuthorizeUrl(c.env.DISCORD_CLIENT_ID, redirectUri, stateId));
});
```

- [ ] **Step 3: 加入 `/api/auth/discord/login`（流程三發動端點）**

緊接著加入：

```ts
// 流程三發動端點：任何頁面都能點「用 Discord 登入」，不需要先有既有 cookie。
app.get('/api/auth/discord/login', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const { success } = await c.env.RATE_LIMITER.limit({ key: `discord-login:${ip}` });
  if (!success) return c.json({ error: '操作太頻繁，請稍後再試' }, 429);
  const stateId = await oauthState.createState(c.env.OAUTH_STATE, { mode: 'restore' });
  const redirectUri = new URL('/api/auth/discord/callback', c.req.url).toString();
  return c.redirect(discordOAuth.buildAuthorizeUrl(c.env.DISCORD_CLIENT_ID, redirectUri, stateId));
});
```

- [ ] **Step 4: 加入共用的 `/api/auth/discord/callback`**

緊接著加入：

```ts
// 兩個流程共用的 callback。轉址目標只從 KV 存的 state 內容自己組出來，
// 不接受、不讀取 callback request 上任何額外的 query 參數當轉址目標（開放轉址防護）。
app.get('/api/auth/discord/callback', async (c) => {
  const stateId = c.req.query('state');
  const code = c.req.query('code');
  const fail = () => c.redirect('/#/home?discordError=1');
  if (!stateId || !code) return fail();

  const entry = await oauthState.consumeState(c.env.OAUTH_STATE, stateId);
  if (!entry) return fail();

  const redirectUri = new URL('/api/auth/discord/callback', c.req.url).toString();
  const accessToken = await discordOAuth.exchangeCode(c.env.DISCORD_CLIENT_ID, c.env.DISCORD_CLIENT_SECRET, redirectUri, code);
  if (!accessToken) return fail();
  const discordId = await discordOAuth.fetchDiscordId(accessToken);
  if (!discordId) return fail();

  const d = db(c);

  if (entry.mode === 'link') {
    const p = await projectSvc.getProjectRaw(d, entry.slug);
    if (!p) return fail();
    await discordLinksSvc.upsertConfirmedLink(
      d, discordId,
      { kind: entry.charId ? 'char' : 'owner', projectId: entry.projectId, charId: entry.charId, label: p.title },
      entry.rawToken, c.env.LINK_KEY,
    );
    c.header('Set-Cookie', await kgUCookieLine(c.env.LINK_KEY, discordId), { append: true });
    const dest = entry.charId ? `/#/p/${entry.slug}/c/${entry.charId}` : `/#/p/${entry.slug}/manage`;
    return c.redirect(dest);
  }

  // entry.mode === 'restore'：一次還原這個 discordId 底下所有 confirmed=1 的項目
  const rows = await discordLinksSvc.confirmedLinksFor(d, discordId, c.env.LINK_KEY);
  const byProject = new Map<string, { slug: string; ownerToken?: string; charTokens: string[] }>();
  for (const r of rows) {
    const p = await projectSvc.getProjectRaw(d, r.projectId);
    if (!p) continue;
    const info = byProject.get(r.projectId) ?? { slug: p.slug, charTokens: [] };
    if (r.kind === 'owner') info.ownerToken = r.rawToken;
    else info.charTokens.push(r.rawToken);
    byProject.set(r.projectId, info);
  }
  for (const [projectId, info] of byProject) {
    if (info.ownerToken) c.header('Set-Cookie', ownerCookieLine(info.slug, projectId, info.ownerToken), { append: true });
    if (info.charTokens.length) c.header('Set-Cookie', charCookieLineFromTokens(info.slug, projectId, info.charTokens), { append: true });
  }
  c.header('Set-Cookie', await kgUCookieLine(c.env.LINK_KEY, discordId), { append: true });
  return c.redirect('/#/dashboard');
});
```

- [ ] **Step 5: typecheck**

```bash
cd app/api
npm run typecheck
```

Expected: 無錯誤。

- [ ] **Step 6: 既有測試沒壞掉**

```bash
cd app/api
npx vitest run
```

- [ ] **Step 7（手動驗證，需要使用者一起跑）：本機跑一次完整流程一**

```bash
cd app/api
npm run dev
```

在瀏覽器開 `http://localhost:8787/p/<某個測試企劃 slug>/manage`，用開設者碼登入後台，在網址列直接打開：

```
http://localhost:8787/api/p/<slug>/discord-link
```

Expected：轉址到 Discord 授權頁 → 同意後轉回 `http://localhost:8787/#/p/<slug>/manage` → 檢查瀏覽器 DevTools → Application → Cookies，應該看到新的 `kg_u` cookie（Path=`/api`）。

用以下指令直接查 D1 確認 `user_links` 真的多了一列且 `confirmed=1`：

```bash
npx wrangler d1 execute qianguan --local --command "SELECT id, discord_id, kind, confirmed FROM user_links"
```

- [ ] **Step 8: Commit**

```bash
git add app/api/src/index.ts
git commit -m "feat: add Discord OAuth login/link/callback routes (flows 1+3)"
```

**⚠️ 需要使用者動作**：這個 task 完成、手動驗證過後，才把 Task 1 的 migration 套到正式環境：

```bash
cd app/api
npm run db:apply   # --remote，動到正式 Cloudflare D1，先跟使用者確認
```

---

### Task 8: 流程一前端——「連結 Discord」按鈕

**Files:**
- Modify: `app/web/src/pages/Manage.tsx`
- Modify: `app/web/src/pages/CharEdit.tsx`

**Interfaces:**
- Consumes: 無新的 api.ts 函式——按鈕是純 `<a href>` 導覽（讓瀏覽器帶上 Task 7 需要的 `kg_o_`/`kg_c_` cookie），不透過 `fetch`。

- [ ] **Step 1: Manage.tsx 加開設者版「連結 Discord」按鈕**

Edit `app/web/src/pages/Manage.tsx`，在檔尾的 `<StickySaveBar inShell dirty={dirty} busy={saving} onSave={() => { void doSave(); }} />` 之前（第 515 行附近，`authed` 分支已經渲染的區塊內）加入：

```tsx
<div className="mt-6">
  <a href={`/api/p/${slug}/discord-link`} className="kg-pill kg-pill-ghost kg-pill-sm">
    連結 Discord（換裝置時可以一次找回這個企劃）
  </a>
</div>
```

- [ ] **Step 2: CharEdit.tsx 加角色版「連結 Discord」按鈕**

Edit `app/web/src/pages/CharEdit.tsx`，在 `<StickySaveBar inShell dirty={dirty} busy={busy} onSave={() => { void doSave(); }} />`（第 411 行附近）之前加入：

```tsx
<div className="mt-6">
  <a href={`/api/p/${slug}/discord-link?charId=${encodeURIComponent(charId)}`} className="kg-pill kg-pill-ghost kg-pill-sm">
    連結 Discord（換裝置時可以一次找回這個角色）
  </a>
</div>
```

- [ ] **Step 3: typecheck**

```bash
cd app/web
npx tsc --noEmit
```

- [ ] **Step 4（手動驗證）：跑前端 dev server，確認按鈕出現且連結正確**

```bash
cd app/web
npm run dev
```

用瀏覽器開開設者後台／角色編輯頁，確認「連結 Discord」按鈕存在，`href` 分別指向 `/api/p/<slug>/discord-link` 跟 `/api/p/<slug>/discord-link?charId=<charId>`（不用真的點下去跑完整個 OAuth，Task 7 已經手動驗證過後端邏輯）。

- [ ] **Step 5: Commit**

```bash
git add app/web/src/pages/Manage.tsx app/web/src/pages/CharEdit.tsx
git commit -m "feat: add Discord link button to Manage and CharEdit pages"
```

---

### Task 9: 流程二——自動收錄（後端 hook + 前端 toast/取消連結）

**Files:**
- Modify: `app/api/src/index.ts`（五個既有端點加 hook）
- Modify: `app/api/src/services/character.ts`（`toChar` 已含 `project_id`，不用改；只是說明依賴）
- Modify: `app/web/src/components/kg.tsx`（`toast`/`Toaster` 加 action 按鈕支援）
- Modify: `app/web/src/lib/api.ts`（六個既有函式的回應型別加 `discordPending`／`discord_pending`，加 `deleteMyLink`）
- Modify: `app/web/src/pages/NewProject.tsx`、`Join.tsx`、`Manage.tsx`、`CharEdit.tsx`、`Character.tsx`、`Relations.tsx`（呼叫端各加一行）

**Interfaces:**
- Consumes: `discordLinksSvc.autoLink` (Task 5), `verifyKgU` (Task 4)
- Produces: `DiscordPending { linkId: number; label: string }`（前端型別）、`discordPendingToast(pending, unlink)` helper（`components/kg.tsx`）

- [ ] **Step 1: index.ts 加 `maybeAutoLink` helper**

Edit `app/api/src/index.ts`，在 `requireChar` 函式定義之後（`const ts = (c: Ctx, ...` 之前）加入：

```ts
/** 流程二共用 hook：五個會發新 cookie 的端點，在原本 Set-Cookie 那步之後多做一次。
 * 讀 kg_u、驗 HMAC，不合法就整段跳過（等同沒有這個功能）；跳過或既有列命中都回傳 null，
 * 呼叫端據此決定要不要在回應裡附 discord_pending。*/
async function maybeAutoLink(
  c: Ctx,
  target: discordLinksSvc.AutoLinkTarget,
  rawToken: string,
): Promise<{ id: number; label: string } | null> {
  const discordId = await verifyKgU(c.env.LINK_KEY, cookieOf(c));
  if (!discordId) return null;
  return discordLinksSvc.autoLink(db(c), discordId, target, rawToken, c.env.LINK_KEY);
}
```

- [ ] **Step 2: 掛進 `POST /api/projects`**

把：

```ts
app.post('/api/projects', async (c) => {
  const input = await parseBody(c, schema.createProjectSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  if (!input.title.trim()) return c.json({ error: '企劃名不能留空' }, 400);
  if (!(await ts(c, input.turnstile))) return c.json({ error: '人機驗證未通過，請再試一次' }, 403);
  const r = await projectSvc.createProject(db(c), input);
  c.header('Set-Cookie', r.cookie, { append: true });
  return c.json({ project: r.project, ownerToken: r.ownerToken, transferCode: r.transferCode });
});
```

改成：

```ts
app.post('/api/projects', async (c) => {
  const input = await parseBody(c, schema.createProjectSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  if (!input.title.trim()) return c.json({ error: '企劃名不能留空' }, 400);
  if (!(await ts(c, input.turnstile))) return c.json({ error: '人機驗證未通過，請再試一次' }, 403);
  const r = await projectSvc.createProject(db(c), input);
  c.header('Set-Cookie', r.cookie, { append: true });
  const pending = await maybeAutoLink(c, { kind: 'owner', projectId: r.project.id, label: r.project.title }, r.ownerToken);
  return c.json({
    project: r.project, ownerToken: r.ownerToken, transferCode: r.transferCode,
    ...(pending ? { discord_pending: pending } : {}),
  });
});
```

- [ ] **Step 3: 掛進 `POST /api/p/:slug/owner-session`**

把：

```ts
app.post('/api/p/:slug/owner-session', async (c) => {
  const input = await parseBody(c, schema.tokenSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  const r = await projectSvc.verifyOwner(db(c), c.req.param('slug'), cookieOf(c), input.token ?? '');
  if (!r) {
    console.warn(`owner-session auth fail: slug=${c.req.param('slug')} ip=${c.req.header('CF-Connecting-IP') ?? 'unknown'}`);
    return c.json({ error: AUTH_FAIL }, 401);
  }
  if (r.cookie) c.header('Set-Cookie', r.cookie, { append: true });
  return c.json({ project: r.project });
});
```

改成：

```ts
app.post('/api/p/:slug/owner-session', async (c) => {
  const input = await parseBody(c, schema.tokenSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  const r = await projectSvc.verifyOwner(db(c), c.req.param('slug'), cookieOf(c), input.token ?? '');
  if (!r) {
    console.warn(`owner-session auth fail: slug=${c.req.param('slug')} ip=${c.req.header('CF-Connecting-IP') ?? 'unknown'}`);
    return c.json({ error: AUTH_FAIL }, 401);
  }
  let pending: { id: number; label: string } | null = null;
  if (r.cookie) {
    c.header('Set-Cookie', r.cookie, { append: true });
    pending = await maybeAutoLink(c, { kind: 'owner', projectId: r.project.id, label: r.project.title }, (input.token ?? '').trim());
  }
  return c.json({ project: r.project, ...(pending ? { discord_pending: pending } : {}) });
});
```

- [ ] **Step 4: 掛進 `POST /api/p/:slug/join`**

把：

```ts
app.post('/api/p/:slug/join', async (c) => {
  const input = await parseBody(c, schema.joinSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  if (!(await ts(c, input.turnstile))) return c.json({ error: '人機驗證未通過，請再試一次' }, 403);
  const r = await charSvc.joinProject(db(c), c.req.param('slug'), cookieOf(c), input);
  if ('error' in r) return c.json({ error: r.error }, 400);
  c.header('Set-Cookie', r.cookie, { append: true });
  return c.json({ ok: true, character: r.character, charToken: r.charToken });
});
```

改成：

```ts
app.post('/api/p/:slug/join', async (c) => {
  const input = await parseBody(c, schema.joinSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  if (!(await ts(c, input.turnstile))) return c.json({ error: '人機驗證未通過，請再試一次' }, 403);
  const r = await charSvc.joinProject(db(c), c.req.param('slug'), cookieOf(c), input);
  if ('error' in r) return c.json({ error: r.error }, 400);
  c.header('Set-Cookie', r.cookie, { append: true });
  const pending = await maybeAutoLink(
    c, { kind: 'char', projectId: r.character.project_id, charId: r.character.id, label: r.character.name }, r.charToken,
  );
  return c.json({ ok: true, character: r.character, charToken: r.charToken, ...(pending ? { discord_pending: pending } : {}) });
});
```

- [ ] **Step 5: 掛進 `POST /api/p/:slug/c/:charId/session`**

把：

```ts
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
```

改成：

```ts
app.post('/api/p/:slug/c/:charId/session', async (c) => {
  const input = await parseBody(c, schema.tokenSchema);
  if (!input) return c.json({ error: '參數格式不正確' }, 400);
  const r = await charSvc.verifyCharToken(db(c), c.req.param('slug'), c.req.param('charId'), cookieOf(c), input.token ?? '');
  if (!r) {
    console.warn(`char-session auth fail: slug=${c.req.param('slug')} charId=${c.req.param('charId')} ip=${c.req.header('CF-Connecting-IP') ?? 'unknown'}`);
    return c.json({ error: AUTH_FAIL }, 401);
  }
  let pending: { id: number; label: string } | null = null;
  if (r.cookie) {
    c.header('Set-Cookie', r.cookie, { append: true });
    pending = await maybeAutoLink(
      c, { kind: 'char', projectId: r.character.project_id, charId: r.character.id, label: r.character.name }, (input.token ?? '').trim(),
    );
  }
  return c.json({ character: r.character, ...(pending ? { discord_pending: pending } : {}) });
});
```

- [ ] **Step 6: 掛進 `POST /api/p/:slug/c/:charId/draft-char`**

把：

```ts
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
```

改成：

```ts
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
  const pending = await maybeAutoLink(
    c, { kind: 'char', projectId: r.character.project_id, charId: r.character.id, label: r.character.name }, r.charToken,
  );
  return c.json({ ok: true, character: r.character, charToken: r.charToken, ...(pending ? { discord_pending: pending } : {}) });
});
```

- [ ] **Step 7: typecheck + 既有測試**

```bash
cd app/api
npm run typecheck
npx vitest run
```

- [ ] **Step 8: Commit 後端部分**

```bash
git add app/api/src/index.ts
git commit -m "feat: hook auto-link into the five session-issuing endpoints (flow 2)"
```

- [ ] **Step 9: 前端——Toaster 加 action 按鈕支援**

Edit `app/web/src/components/kg.tsx`，把：

```ts
export type ToastKind = 'ok' | 'err';
interface ToastItem {
  id: number;
  msg: string;
  kind: ToastKind;
}
let toastSeq = 1;
const toastListeners = new Set<(t: ToastItem) => void>();

/** 任何地方都能呼叫：toast('已複製') / toast('失敗了', 'err') */
export function toast(msg: string, kind: ToastKind = 'ok') {
  const item: ToastItem = { id: toastSeq++, msg, kind };
  toastListeners.forEach((fn) => fn(item));
}
```

改成：

```ts
export type ToastKind = 'ok' | 'err';
export interface ToastAction { label: string; onClick: () => void }
interface ToastItem {
  id: number;
  msg: string;
  kind: ToastKind;
  action?: ToastAction;
}
let toastSeq = 1;
const toastListeners = new Set<(t: ToastItem) => void>();

/** 任何地方都能呼叫：toast('已複製') / toast('失敗了', 'err') / toast('...', 'ok', { label: '取消連結', onClick }) */
export function toast(msg: string, kind: ToastKind = 'ok', action?: ToastAction) {
  const item: ToastItem = { id: toastSeq++, msg, kind, action };
  toastListeners.forEach((fn) => fn(item));
}
```

在同一個檔案，把 `Toaster` 裡渲染每則 toast 的區塊：

```tsx
{items.map((t) => (
  <div key={t.id} className={`kg-toast ${t.kind === 'err' ? 'kg-toast-err' : ''}`}>
    {t.kind === 'err' ? '✕ ' : '✓ '}
    {t.msg}
  </div>
))}
```

改成：

```tsx
{items.map((t) => (
  <div key={t.id} className={`kg-toast ${t.kind === 'err' ? 'kg-toast-err' : ''}`}>
    {t.kind === 'err' ? '✕ ' : '✓ '}
    {t.msg}
    {t.action && (
      <button type="button" className="ml-3 underline font-bold pointer-events-auto" onClick={t.action.onClick}>
        {t.action.label}
      </button>
    )}
  </div>
))}
```

（外層 `<div>` 已經是 `pointer-events-none`，按鈕要能點必須自己蓋回 `pointer-events-auto`。）

在 `toast`/`Toaster` 定義之後（同一個「Toast 回饋」區塊尾端）加一個共用 helper：

```ts
/** 流程二自動收錄後端會回 discord_pending；前端六個呼叫端都用這個 helper 統一彈 toast + 取消連結按鈕。*/
export function discordPendingToast(pending: { linkId: number; label: string } | undefined, unlink: (id: number) => Promise<{ ok: boolean }>) {
  if (!pending) return;
  toast(`已加入「${pending.label}」到你的 Discord 待確認清單`, 'ok', {
    label: '取消連結',
    onClick: () => { void unlink(pending.linkId).then(() => toast('已取消連結')); },
  });
}
```

- [ ] **Step 10: 前端——api.ts 型別與新函式**

Edit `app/web/src/lib/api.ts`，在 `AUTH_FAIL`/`FEED_LIMIT` 定義附近加入型別：

```ts
export interface DiscordPending { linkId: number; label: string }
```

把 `createProject`：

```ts
export async function createProject(input: NewProjectInput): Promise<{ project: Project; ownerToken: string }> {
  // 回應同時種 kg_o_ cookie；ownerToken 只出現這一次（畫面顯示一次，§4.1）
  return req('POST', '/projects', input);
}
```

改成：

```ts
export async function createProject(input: NewProjectInput): Promise<{ project: Project; ownerToken: string; discordPending?: DiscordPending }> {
  // 回應同時種 kg_o_ cookie；ownerToken 只出現這一次（畫面顯示一次，§4.1）
  const r = await req<{ project: Project; ownerToken: string; discord_pending?: DiscordPending }>('POST', '/projects', input);
  return { project: r.project, ownerToken: r.ownerToken, discordPending: r.discord_pending };
}
```

把 `verifyOwner`：

```ts
/** 開設者身分驗證：cookie 優先；貼碼救援時帶 token，成功即種 cookie */
export async function verifyOwner(slug: string, token = ''): Promise<Project | null> {
  try {
    const r = await req<{ project: Project }>('POST', `/p/${encodeURIComponent(slug)}/owner-session`, { token });
    return r.project;
  } catch {
    return null;
  }
}
```

改成：

```ts
/** 開設者身分驗證：cookie 優先；貼碼救援時帶 token，成功即種 cookie */
export async function verifyOwner(slug: string, token = ''): Promise<(Project & { discordPending?: DiscordPending }) | null> {
  try {
    const r = await req<{ project: Project; discord_pending?: DiscordPending }>('POST', `/p/${encodeURIComponent(slug)}/owner-session`, { token });
    return { ...r.project, discordPending: r.discord_pending };
  } catch {
    return null;
  }
}
```

把 `joinProject`：

```ts
export async function joinProject(
  slug: string,
  input: JoinInput,
): Promise<{ ok: true; character: Character; charToken: string } | { ok: false; error: string }> {
  // 成功時回應種 kg_c_ cookie；charToken 只出現這一次
  return tryReq('POST', `/p/${encodeURIComponent(slug)}/join`, input);
}
```

改成：

```ts
export async function joinProject(
  slug: string,
  input: JoinInput,
): Promise<{ ok: true; character: Character; charToken: string; discordPending?: DiscordPending } | { ok: false; error: string }> {
  // 成功時回應種 kg_c_ cookie；charToken 只出現這一次
  const r = await tryReq<
    { ok: true; character: Character; charToken: string; discord_pending?: DiscordPending } | { ok: false; error: string }
  >('POST', `/p/${encodeURIComponent(slug)}/join`, input);
  return r.ok ? { ok: true, character: r.character, charToken: r.charToken, discordPending: r.discord_pending } : r;
}
```

把 `verifyCharToken`：

```ts
/** 角色本人驗證：cookie 優先；貼編輯碼救援時帶 token，成功即種 cookie */
export async function verifyCharToken(slug: string, charId: string, token = ''): Promise<Character | null> {
  try {
    const r = await req<{ character: Character }>('POST', `/p/${encodeURIComponent(slug)}/c/${encodeURIComponent(charId)}/session`, { token });
    return r.character;
  } catch {
    return null;
  }
}
```

改成：

```ts
/** 角色本人驗證：cookie 優先；貼編輯碼救援時帶 token，成功即種 cookie */
export async function verifyCharToken(slug: string, charId: string, token = ''): Promise<(Character & { discordPending?: DiscordPending }) | null> {
  try {
    const r = await req<{ character: Character; discord_pending?: DiscordPending }>(
      'POST', `/p/${encodeURIComponent(slug)}/c/${encodeURIComponent(charId)}/session`, { token },
    );
    return { ...r.character, discordPending: r.discord_pending };
  } catch {
    return null;
  }
}
```

把 `createDraftCharacter`：

```ts
export async function createDraftCharacter(
  slug: string,
  charId: string,
  _token: string,
  name: string,
): Promise<{ ok: true; character: Character; charToken: string } | { ok: false; error: string }> {
  return tryReq('POST', `/p/${encodeURIComponent(slug)}/c/${encodeURIComponent(charId)}/draft-char`, { name });
}
```

改成：

```ts
export async function createDraftCharacter(
  slug: string,
  charId: string,
  _token: string,
  name: string,
): Promise<{ ok: true; character: Character; charToken: string; discordPending?: DiscordPending } | { ok: false; error: string }> {
  const r = await tryReq<
    { ok: true; character: Character; charToken: string; discord_pending?: DiscordPending } | { ok: false; error: string }
  >('POST', `/p/${encodeURIComponent(slug)}/c/${encodeURIComponent(charId)}/draft-char`, { name });
  return r.ok ? { ok: true, character: r.character, charToken: r.charToken, discordPending: r.discord_pending } : r;
}
```

在檔尾（動態牆區塊之後）加入 Flow 4 要用的 `deleteMyLink`（這裡先加，Task 10 的 `getMyLinks`/`confirmMyLink`/`unconfirmMyLink` 另外加）：

```ts
// ---------- Discord 帳號 ----------
export async function deleteMyLink(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  return tryReq('DELETE', `/me/links/${id}`);
}
```

- [ ] **Step 11: 前端——六個呼叫端各加一行**

Edit `app/web/src/pages/NewProject.tsx`，把：

```ts
      const result = await createProject({
        title: live,
        summary,
        cover_url: coverUrl,
        icon_url: iconUrl,
        visibility,
        join_mode: joinMode,
        join_code: joinCode,
        links: sanitizeLinks(links),
        turnstile: turnstileToken || 'dev-bypass',
      });
      setCreated(result);
```

改成：

```ts
      const result = await createProject({
        title: live,
        summary,
        cover_url: coverUrl,
        icon_url: iconUrl,
        visibility,
        join_mode: joinMode,
        join_code: joinCode,
        links: sanitizeLinks(links),
        turnstile: turnstileToken || 'dev-bypass',
      });
      discordPendingToast(result.discordPending, deleteMyLink);
      setCreated(result);
```

並在檔案頂端的 import 加上 `discordPendingToast`（跟既有的 `toast` import 同一行）與 `deleteMyLink`（跟既有的 `createProject` import 同一行）。

Edit `app/web/src/pages/Join.tsx`，把：

```ts
      if (!res.ok) return setError(res.error);
      // charToken 只顯示這一次；cookie 已由後端種好（§4.2）
      addMyChar({ slug, projectTitle: project.title, charId: res.character.id, name: res.character.name });
      toast(`「${res.character.name}」已加入企劃`);
      setCreated(res);
```

改成：

```ts
      if (!res.ok) return setError(res.error);
      // charToken 只顯示這一次；cookie 已由後端種好（§4.2）
      addMyChar({ slug, projectTitle: project.title, charId: res.character.id, name: res.character.name });
      toast(`「${res.character.name}」已加入企劃`);
      discordPendingToast(res.discordPending, deleteMyLink);
      setCreated(res);
```

（`toast`/`joinProject` 已經是既有 import，補上 `discordPendingToast`、`deleteMyLink`。）

Edit `app/web/src/pages/Manage.tsx`，把：

```ts
            onSubmit={async () => {
              setGateBusy(true);
              setGateError(null);
              const ok = await verifyOwner(slug, gateToken); // 驗過後端會種 cookie
              setGateBusy(false);
              if (!ok) return setGateError('企劃不存在或權杖錯誤');
              setAuthed(true);
              applyProject(ok);
              snapshot.current = JSON.stringify({ ...currentForm(), joinCode: '' });
              setRows(await rosterStats(slug));
            }}
```

改成：

```ts
            onSubmit={async () => {
              setGateBusy(true);
              setGateError(null);
              const ok = await verifyOwner(slug, gateToken); // 驗過後端會種 cookie
              setGateBusy(false);
              if (!ok) return setGateError('企劃不存在或權杖錯誤');
              setAuthed(true);
              applyProject(ok);
              discordPendingToast(ok.discordPending, deleteMyLink);
              snapshot.current = JSON.stringify({ ...currentForm(), joinCode: '' });
              setRows(await rosterStats(slug));
            }}
```

Edit `app/web/src/pages/CharEdit.tsx`，把：

```ts
            onSubmit={async () => {
              setGateBusy(true);
              setGateError(null);
              const ok = await verifyCharToken(slug, charId, gateToken);
              setGateBusy(false);
              if (!ok) return setGateError('企劃不存在或權杖錯誤');
              setAuthed(true);
              applyChar(ok);
              snapshot.current = JSON.stringify(currentForm());
            }}
```

改成：

```ts
            onSubmit={async () => {
              setGateBusy(true);
              setGateError(null);
              const ok = await verifyCharToken(slug, charId, gateToken);
              setGateBusy(false);
              if (!ok) return setGateError('企劃不存在或權杖錯誤');
              setAuthed(true);
              applyChar(ok);
              discordPendingToast(ok.discordPending, deleteMyLink);
              snapshot.current = JSON.stringify(currentForm());
            }}
```

Edit `app/web/src/pages/Character.tsx`，把：

```ts
  const claim = async () => {
    setClaimError(null);
    const ok = await verifyCharToken(slug, charId, claimToken); // 驗過後端種 cookie
    if (!ok) return setClaimError('企劃不存在或權杖錯誤');
    setClaimOpen(false);
    setClaimToken('');
    refresh();
  };
```

改成：

```ts
  const claim = async () => {
    setClaimError(null);
    const ok = await verifyCharToken(slug, charId, claimToken); // 驗過後端種 cookie
    if (!ok) return setClaimError('企劃不存在或權杖錯誤');
    discordPendingToast(ok.discordPending, deleteMyLink);
    setClaimOpen(false);
    setClaimToken('');
    refresh();
  };
```

（`Character.tsx` 目前的 import 沒有 `deleteMyLink`/`discordPendingToast`，要在檔案頂端補上——`discordPendingToast` 從 `../components/kg`，`deleteMyLink` 從 `../lib/api`。）

Edit `app/web/src/pages/Relations.tsx`，把（TokenGate 提交）：

```ts
            onSubmit={async () => {
              setGateBusy(true);
              setGateError(null);
              const ok = await verifyCharToken(slug, charId, gateToken);
              setGateBusy(false);
              if (!ok) return setGateError('企劃不存在或權杖錯誤');
              setToken('cookie'); // 已種 cookie
            }}
```

改成：

```ts
            onSubmit={async () => {
              setGateBusy(true);
              setGateError(null);
              const ok = await verifyCharToken(slug, charId, gateToken);
              setGateBusy(false);
              if (!ok) return setGateError('企劃不存在或權杖錯誤');
              discordPendingToast(ok.discordPending, deleteMyLink);
              setToken('cookie'); // 已種 cookie
            }}
```

並把（新增角色 draft）：

```ts
  const doCreateDraft = async () => {
    setFormError(null);
    if (!draftName.trim()) return setFormError('請填對方角色的名字');
    setDraftBusy(true);
    try {
      const res = await createDraftCharacter(slug, charId, token, draftName);
      if (!res.ok) return setFormError(res.error);
      setDraftResult(res);
      setTargetId(res.character.id);
      setDraftName('');
      await refresh();
    } finally {
      setDraftBusy(false);
    }
  };
```

改成：

```ts
  const doCreateDraft = async () => {
    setFormError(null);
    if (!draftName.trim()) return setFormError('請填對方角色的名字');
    setDraftBusy(true);
    try {
      const res = await createDraftCharacter(slug, charId, token, draftName);
      if (!res.ok) return setFormError(res.error);
      discordPendingToast(res.discordPending, deleteMyLink);
      setDraftResult(res);
      setTargetId(res.character.id);
      setDraftName('');
      await refresh();
    } finally {
      setDraftBusy(false);
    }
  };
```

- [ ] **Step 12: typecheck**

```bash
cd app/web
npx tsc --noEmit
```

Expected: 無錯誤——每個改動的檔案都要確認 `discordPendingToast`/`deleteMyLink` 的 import 有補上。

- [ ] **Step 13（手動驗證）：跑一次完整的自動收錄流程**

用 Task 7 Step 7 已經建立的 `kg_u` cookie（先走一次流程一連結某個企劃 A），接著在同一個瀏覽器對另一個企劃 B 用開設者碼貼碼救援登入。

Expected：B 的 owner-session 回應應該帶 `discord_pending`，前端跳出「已加入『B 的標題』到你的 Discord 待確認清單」的 toast，且有「取消連結」按鈕；查 D1：

```bash
cd app/api
npx wrangler d1 execute qianguan --local --command "SELECT id, discord_id, kind, confirmed FROM user_links ORDER BY id"
```

應該看到 A 的列 `confirmed=1`，B 的列 `confirmed=0`。點 toast 上的「取消連結」，該列應該從 `user_links` 消失（Task 10 完成後才有 `DELETE /api/me/links/:id` 可以真的執行這步；這裡先確認 toast 出現、按鈕存在即可，實際刪除驗證留到 Task 10）。

- [ ] **Step 14: Commit**

```bash
git add app/web/src/components/kg.tsx app/web/src/lib/api.ts \
  app/web/src/pages/NewProject.tsx app/web/src/pages/Join.tsx app/web/src/pages/Manage.tsx \
  app/web/src/pages/CharEdit.tsx app/web/src/pages/Character.tsx app/web/src/pages/Relations.tsx
git commit -m "feat: wire discord_pending toast + unlink action across all auto-link entry points"
```

---

### Task 10: 流程四——儀表板（確認／解除連結）

**Files:**
- Modify: `app/api/src/index.ts`（四個新端點）
- Modify: `app/web/src/lib/api.ts`（`getMyLinks`/`confirmMyLink`/`unconfirmMyLink`）
- Create: `app/web/src/pages/Dashboard.tsx`
- Modify: `app/web/src/App.tsx`（`/dashboard` 路由 + `discordError` 全域 toast）
- Modify: `app/web/src/components/kg.tsx`（`SiteHeader` 加「用 Discord 登入」入口）

**Interfaces:**
- Consumes: `discordLinksSvc.listLinksFor/setConfirmed/deleteLink` (Task 5)、`verifyKgU` (Task 4)

- [ ] **Step 1: index.ts 加四個 `/api/me/links...` 端點**

Edit `app/api/src/index.ts`，在牽線區塊（`app.post('/api/p/:slug/relations/:id/unwire', ...)`）之後、OG meta 區塊之前加入：

```ts
// ================= 流程四：Discord 帳號儀表板 =================

app.get('/api/me/links', async (c) => {
  const discordId = await verifyKgU(c.env.LINK_KEY, cookieOf(c));
  if (!discordId) return c.json({ error: AUTH_FAIL }, 401);
  return c.json(await discordLinksSvc.listLinksFor(db(c), discordId));
});

app.post('/api/me/links/:id/confirm', async (c) => {
  const discordId = await verifyKgU(c.env.LINK_KEY, cookieOf(c));
  if (!discordId) return c.json({ error: AUTH_FAIL }, 401);
  const ok = await discordLinksSvc.setConfirmed(db(c), discordId, Number(c.req.param('id')), true);
  if (!ok) return c.json({ error: AUTH_FAIL }, 404);
  return c.json({ ok: true });
});

app.post('/api/me/links/:id/unconfirm', async (c) => {
  const discordId = await verifyKgU(c.env.LINK_KEY, cookieOf(c));
  if (!discordId) return c.json({ error: AUTH_FAIL }, 401);
  const ok = await discordLinksSvc.setConfirmed(db(c), discordId, Number(c.req.param('id')), false);
  if (!ok) return c.json({ error: AUTH_FAIL }, 404);
  return c.json({ ok: true });
});

app.delete('/api/me/links/:id', async (c) => {
  const discordId = await verifyKgU(c.env.LINK_KEY, cookieOf(c));
  if (!discordId) return c.json({ error: AUTH_FAIL }, 401);
  const ok = await discordLinksSvc.deleteLink(db(c), discordId, Number(c.req.param('id')));
  if (!ok) return c.json({ error: AUTH_FAIL }, 404);
  return c.json({ ok: true });
});
```

- [ ] **Step 2: typecheck + 既有測試**

```bash
cd app/api
npm run typecheck
npx vitest run
```

- [ ] **Step 3: Commit 後端部分**

```bash
git add app/api/src/index.ts
git commit -m "feat: add dashboard endpoints (list/confirm/unconfirm/delete links)"
```

- [ ] **Step 4: 前端 api.ts 加儀表板函式**

Edit `app/web/src/lib/api.ts`，把 Task 9 加的 `deleteMyLink` 所在區塊擴充成：

```ts
// ---------- Discord 帳號 ----------
export interface DiscordLink { id: number; kind: 'owner' | 'char'; confirmed: boolean; projectTitle: string; charName?: string }

export async function getMyLinks(): Promise<DiscordLink[]> {
  try {
    return await req<DiscordLink[]>('GET', '/me/links');
  } catch {
    return [];
  }
}

export async function confirmMyLink(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  return tryReq('POST', `/me/links/${id}/confirm`);
}

export async function unconfirmMyLink(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  return tryReq('POST', `/me/links/${id}/unconfirm`);
}

export async function deleteMyLink(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  return tryReq('DELETE', `/me/links/${id}`);
}
```

（`deleteMyLink` 已經在 Task 9 加過，這裡是把它跟新加的三個函式放在同一個區塊，避免重複定義——如果 Task 9 已經把 `deleteMyLink` 放在檔尾，這一步只要在它上面補 `DiscordLink`/`getMyLinks`/`confirmMyLink`/`unconfirmMyLink`。）

- [ ] **Step 5: 建立 Dashboard.tsx**

Create `app/web/src/pages/Dashboard.tsx`：

```tsx
import { useEffect, useState } from 'react';
import { confirmMyLink, deleteMyLink, getMyLinks, unconfirmMyLink, type DiscordLink } from '../lib/api';
import { href } from '../lib/nav';
import { EmptyNote, PageLoading, SecLabel, SiteFooter, SiteHeader, toast } from '../components/kg';

export default function DashboardPage() {
  const [links, setLinks] = useState<DiscordLink[] | undefined>(undefined);

  const refresh = async () => setLinks(await getMyLinks());

  useEffect(() => {
    document.title = '我的 Discord 連結 — 牽關';
    refresh();
  }, []);

  if (links === undefined) {
    return (
      <>
        <SiteHeader />
        <PageLoading text="正在讀取你的 Discord 連結…" />
        <SiteFooter />
      </>
    );
  }

  const confirmed = links.filter((l) => l.confirmed);
  const pending = links.filter((l) => !l.confirmed);

  const doConfirm = async (id: number) => {
    const r = await confirmMyLink(id);
    if (!r.ok) return toast(r.error, 'err');
    toast('已確認');
    await refresh();
  };
  const doUnconfirm = async (id: number) => {
    const r = await unconfirmMyLink(id);
    if (!r.ok) return toast(r.error, 'err');
    toast('已改回待確認');
    await refresh();
  };
  const doDelete = async (id: number) => {
    const r = await deleteMyLink(id);
    if (!r.ok) return toast(r.error, 'err');
    toast('已移除');
    await refresh();
  };

  const nameOf = (l: DiscordLink) => (l.kind === 'char' ? l.charName ?? '（角色）' : l.projectTitle);

  return (
    <>
      <SiteHeader />
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 w-full">
        <h1 className="font-huninn text-4xl">我的 Discord 連結</h1>
        <p className="font-mono2 text-xs text-[#6f6156] mt-2">
          這裡列出這個 Discord 帳號底下所有企劃／角色。只顯示名稱，不顯示封面或簡介。
        </p>

        <section className="mt-8">
          <SecLabel>待確認</SecLabel>
          {pending.length === 0 ? (
            <EmptyNote>沒有待確認的項目。</EmptyNote>
          ) : (
            <div className="space-y-3 mt-3">
              {pending.map((l) => (
                <div key={l.id} className="kg-card-flat p-4 flex items-center justify-between gap-3">
                  <div>
                    <span className="kg-tag mr-2">{l.kind === 'owner' ? '企劃' : '角色'}</span>
                    {nameOf(l)}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="kg-pill kg-pill-red kg-pill-sm" onClick={() => doConfirm(l.id)}>
                      這是我的
                    </button>
                    <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm" onClick={() => doDelete(l.id)}>
                      不是我／忽略
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mt-10">
          <SecLabel>已確認</SecLabel>
          {confirmed.length === 0 ? (
            <EmptyNote>還沒有已確認的連結。</EmptyNote>
          ) : (
            <div className="space-y-3 mt-3">
              {confirmed.map((l) => (
                <div key={l.id} className="kg-card-flat p-4 flex items-center justify-between gap-3">
                  <div>
                    <span className="kg-tag mr-2">{l.kind === 'owner' ? '企劃' : '角色'}</span>
                    {nameOf(l)}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm" onClick={() => doUnconfirm(l.id)}>
                      取消確認
                    </button>
                    <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm" onClick={() => doDelete(l.id)}>
                      取消連結
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <p className="font-mono2 text-[11px] text-[#6f6156] mt-8">
          找不到你的企劃／角色？回到<a href={href('/home')} className="underline">首頁</a>，用貼碼救援還是隨時可以進去。
        </p>
      </div>
      <SiteFooter />
    </>
  );
}
```

- [ ] **Step 6: App.tsx 加 `/dashboard` 路由 + `discordError` 全域 toast**

Edit `app/web/src/App.tsx`，加 import：

```ts
import DashboardPage from './pages/Dashboard';
```

把路由判斷：

```ts
  let page: ReactNode;
  if (seg.length === 0) page = <Poster />;
  else if (seg[0] === 'home') page = <Home />;
  else if (seg[0] === 'new') page = <NewProject />;
```

改成：

```ts
  let page: ReactNode;
  if (seg.length === 0) page = <Poster />;
  else if (seg[0] === 'home') page = <Home />;
  else if (seg[0] === 'dashboard') page = <DashboardPage />;
  else if (seg[0] === 'new') page = <NewProject />;
```

在既有的 `unhandledrejection` `useEffect` 之後加一個新的 `useEffect`，處理 callback 失敗時的 `#/home?discordError=1` 導回：

```ts
  // Discord OAuth callback 失敗時導回這裡並帶 ?discordError=1；讀到就 toast 一次並清掉，避免重整頁面又跳一次
  useEffect(() => {
    if (!path.includes('discordError=1')) return;
    toast('Discord 連結失敗，請再試一次', 'err');
    const clean = path.split('?')[0];
    window.location.hash = `#${clean}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
```

- [ ] **Step 7: SiteHeader 加「用 Discord 登入」入口**

Edit `app/web/src/components/kg.tsx`，把 `SiteHeader` 裡的 nav：

```tsx
        <nav className="flex items-center gap-2 sm:gap-3">
          <a href={href('/home')} className="kg-pill kg-pill-ghost kg-pill-sm">
            首頁
          </a>
          <a href={href('/new')} className="kg-pill kg-pill-red kg-pill-sm">
            ＋ 建立企劃
          </a>
        </nav>
```

改成：

```tsx
        <nav className="flex items-center gap-2 sm:gap-3">
          <a href={href('/home')} className="kg-pill kg-pill-ghost kg-pill-sm">
            首頁
          </a>
          <a href="/api/auth/discord/login" className="kg-pill kg-pill-ghost kg-pill-sm">
            用 Discord 登入
          </a>
          <a href={href('/new')} className="kg-pill kg-pill-red kg-pill-sm">
            ＋ 建立企劃
          </a>
        </nav>
```

- [ ] **Step 8: typecheck**

```bash
cd app/web
npx tsc --noEmit
```

- [ ] **Step 9（手動驗證）：完整跑一次流程三＋四**

```bash
cd app/api && npm run dev &
cd app/web && npm run dev
```

1. 用 Task 7/9 已經建立的 `kg_u`（至少有一個 `confirmed=1`、一個 `confirmed=0` 的列），點 SiteHeader 的「用 Discord 登入」。
2. Expected：走完 Discord 同意畫面後轉回 `/#/dashboard`，DevTools 檢查 `confirmed=1` 對應的企劃/角色的 `kg_o_`/`kg_c_` cookie 應該已經還原（存在且值非空）。
3. Dashboard 頁面：「待確認」區塊應該看得到那個 `confirmed=0` 的項目，點「這是我的」後應該移到「已確認」區塊；點「取消連結」應該從清單消失，且 D1 裡那一列真的被刪除：

```bash
cd app/api
npx wrangler d1 execute qianguan --local --command "SELECT id FROM user_links"
```

- [ ] **Step 10: Commit**

```bash
git add app/web/src/lib/api.ts app/web/src/pages/Dashboard.tsx app/web/src/App.tsx app/web/src/components/kg.tsx
git commit -m "feat: add Discord dashboard page (flow 4) and site-wide login entry"
```

---

## 完成後的整體驗證清單

- [ ] `cd app/api && npm run typecheck && npx vitest run` 全綠
- [ ] `cd app/web && npx tsc --noEmit` 全綠
- [ ] 手動走過一次完整四條流程（Task 7/9/10 各自的手動驗證步驟）
- [ ] 確認 `LINK_KEY`／`OAUTH_STATE`／Discord Redirect URI 都已經在正式環境設定好（Task 2 的使用者動作）
- [ ] 確認 `0002_user_links.sql` 已經套用到正式 D1（Task 7 尾端的使用者動作）
- [ ] 到正式網址 `https://qianguan.beibeiz.workers.dev` 上真的跑一次流程一（連結）＋流程三（restore），不只本機驗證
