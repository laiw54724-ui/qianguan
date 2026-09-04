# 牽關 — Discord 唯一身分設計（P2 第二步）

> 2026-09-04 ｜ 對照基準：《牽關-問題整理與工單.md》P2 第二步、`app/api/src/auth/guard.ts`、`app/api/src/services/character.ts`、`app/api/src/services/relation.ts`
> 狀態：**設計完整，準備進 writing-plans**
>
> 跟 `docs/archive/2026-09-03-discord-account-linking-design.md` 的關係：那份文件是「Discord 選配、權杖繼續存在」的方向，已作廢。這份文件是「Discord 唯一身分、權杖淨刪除」，兩者互斥，這份是唯一在走的方向。

## 目標

用 Discord 帳號取代現有的「企劃/角色各自一組權杖」模型。登入一次，就能操作自己所有的企劃與角色，不用記、不用貼任何碼。

**核心判斷（已與使用者確認）**：
- 讀取永遠公開（公開/unlisted-by-link 的企劃與角色頁不需要登入就能看）；建立、加入、編輯一律要先用 Discord 登入。
- 這是淨刪除，不是疊加——`chr_`/`own_` 權杖、TokenGate、三層權杖存放、`user_links` 加密（那是另一份已作廢設計的東西）全部消失，換成一套更簡單的 session 模型。
- 正式環境現有的 4 個企劃、3 隻角色都是測試資料，遷移時直接清空，不做資料轉換或移交機制。

## 資料模型

### 新表 `sessions`

```sql
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  discord_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_discord ON sessions(discord_id);
CREATE INDEX idx_sessions_exp ON sessions(expires_at);
```

- `token_hash`：跟現有 `chr_`/`own_` 權杖完全同一套模式——伺服器只存 SHA-256 雜湊，cookie 帶明文。
- 原始 token 用 `token.ts` 既有的 `genToken()`（128-bit CSPRNG，Crockford Base32），**不用 `crypto.randomUUID()`**（UUID v4 只有 122 bits 且格式可辨識）。`genToken` 的 prefix union 從 `'chr' | 'own' | 'inv'` 縮成只剩 `'ses'`——`chr_`/`own_`/`inv_`（移交碼）都沒有呼叫端了。
- `expires_at`：建立當下固定寫死 `created_at + 15552000000`（180 天，跟現有 cookie `Max-Age` 對齊），**不做 sliding 續期**。查詢一律連同 `expires_at > now()` 一起比對；過期的列視同不存在（不主動清理，之後要做的話再加排程）。
- **不要在 `characters.discord_id` 上加任何 `ON DELETE` 相關的 FK cascade**——現在沒有 `users` 表，這欄位只是一個裸的字串參照。以後如果做帳號刪除，那是另一個功能的事，不要現在就埋一個會誤刪一整批角色的機制。

### 既有欄位轉正

`projects.owner_discord_id`、`characters.discord_id`（schema 裡已經預留但從沒真的用過）現在是真正的擁有權欄位。`characters.discord_id` **不加 unique 約束**——一個 Discord 帳號可以擁有多隻角色、多個企劃。

### 淨刪除的欄位

- `projects.owner_token_hash`
- `projects.transfer_code_hash`（見下方「企劃移交」）
- `characters.edit_token_hash`

### 企劃移交

`transfer_code_hash` 原本要解決「代開企劃後移交給正式主催」的情境，這個情境沒有消失，只是機制變了——現在是把 `owner_discord_id` 換成另一個人的 discord_id。**v1 不做這個功能的 UI 或端點**，量很少，值不得為它做一套流程；發生時由管理者直接手動改 D1。這件事記在這裡，避免之後有人以為漏做了。

### 角色數量上限

同一個 `(project_id, discord_id)` 組合最多 **20 隻**角色（`status != 'removed'` 的數量），建立時檢查，超過拒絕。建角色現在不需要任何成本（不用貼碼、不用付費），沒有上限的話容易被濫用洗出大量角色。

### 遷移

`app/api/drizzle/0005_discord_sole_identity.sql`（確切檔名等 writing-plans 階段依序號決定）要做：
1. 建 `sessions` 表。
2. **清空 `projects`、`characters`（連帶 `relations`、`relation_notes`、`private_relations`、`events` 一起清）**——因為 `characters.edit_token_hash`/`projects.owner_token_hash` 現在是 `NOT NULL`，正式環境既有列都沒有 `discord_id`，遷移後會變成無主資料，沒有人能編輯。這是**破壞性動作**，執行前要在 writing-plans 階段的 task 裡明確標成「需要使用者在動手前另外確認」，不能當成遷移檔案裡一行安靜的 `DELETE FROM`。
3. 拿掉 `owner_token_hash`/`transfer_code_hash`/`edit_token_hash` 三個欄位。

## 登入流程

沿用已作廢設計裡「KV 存一次性 state、回呼轉址目標只從 state 組出」的機制（那部分設計是對的，只是原本疊在權杖系統之上；現在是唯一路徑），但只有一種模式，不再有 link/restore 兩種分支。

### 發動登入

`GET /api/auth/discord/login?next=<path>`：

- `next` 驗證規則寫死：必須以 `/` 開頭、**不得以 `//` 開頭**（`//evil.com` 是協議相對網址，瀏覽器會直接當成外部絕對網址，是最經典的開放轉址繞過）、不含 `\`（某些瀏覽器把反斜線當斜線處理）、不含換行。不符合就靜默退回預設值（`/dashboard`），不報錯。
- 這個 `next` 值連同一次性 `state_id` 一起寫進 `OAUTH_STATE` KV（沿用已作廢設計的 KV 一次性 state 機制：高熵 CSPRNG state_id 當 key，讀到就刪，TTL 5 分鐘保底）。
- 轉址到 Discord authorize URL，`scope=identify`。

### Callback

`GET /api/auth/discord/callback?code=&state=&error=`：

1. `state_id` 缺失 → 轉去預設頁，不顯示錯誤。
2. 從 KV 讀 `state_id`（讀到就刪，一次性）；讀不到 → 轉去預設頁。
3. **先檢查 `error` 參數**——使用者在 Discord 授權畫面按「取消」，Discord 會帶 `error=access_denied` 轉回來，這不是錯誤，是使用者改變主意。有 `error` 就直接轉去 state 裡存的 `next`（或首頁），不顯示任何錯誤訊息。
4. 沒有 `error` 但也沒有 `code` → 轉去預設頁（真的異常情況）。
5. 用 `code` 換 access token，打 `/users/@me` 拿 `discord_id`（只取這一個欄位，username/avatar 用完即丟，不進任何持久化儲存、不進 log——這條隱私規則從已作廢設計原封不動繼承）。
6. **不管請求裡帶著的 `kg_session` cookie是否有效、是不是同一個 discord_id，一律先撤銷它**：如果 cookie 存在，刪掉 `sessions` 裡對應的那一列。不分「同帳號重新登入」跟「換帳號登入」兩種情況——兩者的正確處理是一樣的（撤銷舊的、發新的），不用分支。這同時解決了共用電腦上「換人登入後，前一個人的有效 session 沒人能撤銷」的問題。
7. 建立新的 `sessions` 列，簽出新的 `ses_` token，設 `kg_session` cookie。
8. 轉址到 state 裡存的 `next`。

### 登出

- `POST /api/auth/logout`：刪掉 `kg_session` cookie 對應的那一筆 `sessions` 列，回應設 `kg_session=; Max-Age=0`。
- `POST /api/auth/logout-all`：`DELETE FROM sessions WHERE discord_id = ?`（先解出目前 session 的 discord_id），順便清掉自己這個裝置的 cookie。查詢很便宜，一起做。

### Cookie 屬性

`kg_session=<ses_token>; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=15552000`——跟現有其他 cookie 屬性一致，只差 `Path` 從 `/api/p/<slug>` 變成全站的 `/api`。

**重要限制**：因為 `Path=/api`，瀏覽器**不會**把 `kg_session` 送到 `/dashboard` 這種非 `/api/*` 的請求（包括 Worker 的 SPA-shell fallback 本身）。這代表 **`/dashboard` 沒有辦法在伺服器端做登入檢查跟轉址**——Worker 永遠原樣吐出 SPA shell，「沒登入就轉去登入頁」這件事只能在前端掛載後呼叫 `GET /api/me` 才知道，是客戶端轉址，不是伺服器端 302。前端要處理這個畫面短暫閃爍的 loading 狀態（沿用既有的 `PageLoading`/骨架畫面模式即可，不是新問題）。

## 權限模型

一個共用的 session 解析函式取代掉整個 `guard.ts` 的權杖比對邏輯：

```ts
async function resolveSession(db, cookieHeader): Promise<{ discordId: string } | null>
```

雜湊 `kg_session` 的原始 token，查 `sessions`（一併比對 `expires_at > now()`），回傳 `discord_id` 或 `null`。

### 角色權限：編輯跟移除是兩條不同的檢查

```ts
requireChar        → character.discord_id === session.discordId                                    // 編輯用
requireCharManage  → requireChar 成立 OR project.owner_discord_id === session.discordId             // 移除用
```

主催（企劃的 `owner_discord_id`）**可以移除任何角色**（工單 §4.3 既有規則，v2 仍然成立——有人亂填、中途退出、上傳違規內容，主催得能處理），但**不能編輯**別人角色的內容——改別人角色等於替人發言，是同人圈的紅線。移除一律走現有的軟刪除（`status='removed'`），並寫一筆事件，讓被移除的人知道發生了什麼。

`requireOwner`（企劃本身的編輯權，例如 `PATCH /api/p/:slug`）維持單一形狀：`project.owner_discord_id === session.discordId`，不需要 manage 變體——企劃不像角色，沒有「移除但不能編輯」這種第三方介入的場景。

### 關係權限：屬於雙方，不屬於主催

- `a_note`/`a_label` 只有 session 對得上 `a_id` 這隻角色（`character.discord_id === session.discordId` 其中 `character.id === relation.aId`）的人能改，`b_*` 同理只有對得上 `b_id` 的人能改。**不是「當事人任一方都能改整筆」**——那會讓一方能改掉對方寫的視角，這是最容易實作錯的地方，要特別注意。
- `relation_notes`（1.5-1 已經做的）：雙方都能新增，只有作者能刪自己那條——這條規則不變，只是「這是哪一側」的判斷從權杖雜湊比對換成 `character.discord_id === session.discordId`。
- **主催對任何一條關係都沒有編輯或刪除權**。主催能做的是移除角色（`requireCharManage`），該角色涉及的關係本來就會因為角色被移除而在各處顯示邏輯裡失效（沿用 `removeChar()` 既有的軟刪除行為，不用另外處理關係表）。

### `private_relations`：只有本人，連主催都不行

路由層要用 `requireChar`（嚴格的角色本人比對），**絕對不能用 `requireCharManage`**（那會讓主催也能存取）——這裡最容易埋的實作錯誤就是圖方便套用跟角色管理一樣的檢查。好消息是 P1.5 已經做的 `privateRelation.ts` service 層本來就是用 `ownerCharId` 直接篩選（不透過任何「是不是主催」的旁路），這條規則已經在 service 層鎖死；這次只要確保路由層接的是 `requireChar` 就好。

## 建立企劃／加入企劃

- `POST /api/projects`：需要有效 session（沒有回 401）。`owner_discord_id` 從 session 自動帶入，不再有使用者輸入的欄位。回應不再有 `ownerToken`/`transferCode`（兩者都隨權杖系統一起消失）。
- `POST /api/p/:slug/join`：需要有效 session。`join_mode='code'` 的驗證邏輯不變（`sha256hex(code) === joinCodeHash`）。成功後 `characters.discord_id = session.discordId`，不產生任何 token，回應只有 character 本身。角色數量上限（20/組合）在這裡檢查。
- `GET /api/p/:slug` 的 `viewer.isOwner`/`viewer.myCharIds` 一樣是 session 解出來比對，`myCharIds` 改成查 `characters WHERE project_id=? AND discord_id=?`。
- 讀取端點（角色頁、企劃頁、名單、動態牆……）完全不變，公開行為不受這次改動影響。

## 前端

### Dashboard（`/dashboard`）

新頁面，列出 `owner_discord_id` 對得上目前 session 的所有企劃，以及 `discord_id` 對得上的所有角色（依企劃分組）。登入成功後預設轉址到這裡（除非 `next` 指定了別的頁面）。

### 頁面閘門：兩種不一樣的狀態，不能混在一起

- **未登入**（`GET /api/me` 回 `null`）：顯示「用 Discord 登入」的入口。
- **已登入但不是這頁的擁有者**（`GET /api/me` 有 discord_id，但跟這個角色/企劃的擁有欄位對不上）：**不顯示登入提示**（他已經登入了，再顯示登入提示是誤導）——顯示純唯讀畫面，或一句「你沒有這個頁面的編輯權限」。

`TokenGate` 那種「先擋一個貼碼表單，驗過才顯示內容」的兩段式閘門整個消失——伺服器在每一次 GET 就已經告訴前端 `isOwner`/`owned` 是什麼，前端只要照這兩種狀態分流顯示，不需要額外一輪驗證動作。

### 全域 401 攔截

`lib/api.ts` 的 `req()`/`tryReq()` 封裝加一層：任何回應是 401，一律導去 `/api/auth/discord/login?next=<目前路徑>`（用 `installLinkNavigation`/`commitNavigate` 既有機制），不用彈 modal 或另外保留表單狀態——編輯頁本來就有 `dirty.ts` 的本機緩衝機制，重新登入回來後照既有的「本機復原緩衝」流程走，這條路徑不用重做。

### Turnstile 淨刪除 + 補充限流

`verifyTurnstile`、`turnstile.ts`、`TurnstileWidget`、三個掛載點（建企劃／加入／發起牽線）全部刪除——Discord OAuth 本身就是強真人驗證，疊加 Turnstile 是重複摩擦。

補充防濫用：新增一個按 `discord_id`限流的 Cloudflare Rate Limiting binding（例如 `DISCORD_RATE_LIMITER`，10 次/60 秒），只掛在建企劃／加入／發起牽線這三個高成本寫入動作上，跟既有的全站 IP 限流（30 次/60 秒，涵蓋所有 mutation）疊加、不取代——已登入的單一 Discord 帳號還是有可能被腳本濫用，這條擋在 IP 限流之外多一層。

### `.slot`/`claim_id` 死代碼清理

`character.slot`（`types.ts`）、`claim_id`（`api.ts`/`Join.tsx`）從來沒有被後端接過（`character.ts` 的 `joinProject()` 不讀 `claim_id`，`toChar()` 不輸出 `slot`）——這次順手清掉 `Join.tsx`/`Character.tsx`/`Manage.tsx`/`Roster.tsx` 裡對應的前端殘留碼，不是新行為變更，是清理死路徑。

## 要刪除的東西（完整清單）

**後端**：
- `app/api/src/auth/guard.ts` 幾乎整份（`charCookieLine`/`ownerCookieLine`/`charCookieLineRotate`/`charTokens`/`ownerToken`/`resolveToken`），換成 `sessionCookieLine`/`resolveSession`。`readCookieFrom` 保留（泛用工具，`kg_session` 也要用）。
- `app/api/src/turnstile.ts`
- `token.ts` 的 `genToken` prefix union 縮成只剩 `'ses'`
- `projects.owner_token_hash`/`transfer_code_hash`、`characters.edit_token_hash` 三個欄位
- `charSvc`/`projectSvc` 裡所有簽發／驗證 `chr_`/`own_` 權杖的邏輯

**前端**：
- `TokenGate`、`TokenReveal` 元件（`kg.tsx`）
- 三處 `TokenGate` 使用（`Relations.tsx`/`CharEdit.tsx`/`Manage.tsx`）換成上述兩種閘門狀態
- `TurnstileWidget` 元件與三個掛載點
- `.slot`/`claim_id` 相關前端碼

## 不動的部分

- CSRF 三重防護（SameSite + Origin + `X-KG` header）、既有的全站 IP 限流——都跟身分無關，不受這次改動影響。
- `relation_notes`（1.5-1）、`private_relations`（1.5-2）的資料表結構跟大部分 service 邏輯不變，只有「怎麼判斷這是哪一側/是不是本人」的底層機制從權杖換成 session。
- 讀取端點（GET）完全不變。
- KV 一次性 state 機制、隱私規則（不存 username/avatar）——從已作廢設計繼承，這部分設計本來就是對的。

## v1 明確排除範圍

- 帳號刪除（沒有 `users` 表，`characters.discord_id` 不建立任何刪除時的 cascade 行為，留給未來）
- 企劃移交 UI（v1 由管理者手動改 D1）
- Session 清理排程（過期的列留在表裡，查詢時用 `expires_at` 過濾，不主動刪除）

## 已知限制／後續備忘

- Discord 帳號被盜或停用時，需要能單方面撤銷 session——DB-backed session（而非簽章 cookie）本來就是為了這個而選的，`logout-all` 是現成的撤銷手段，但目前沒有「被盜通報」流程，只能靠使用者自己發現後登出所有裝置。
- 20 隻角色的上限是防濫用用途的硬編碼數字，不是產品需求分析出來的精確值，之後有實際使用回饋再調。
