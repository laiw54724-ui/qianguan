# 牽關 — Discord 帳號整合設計

> 2026-09-03 ｜ 對照基準：《牽關-實際狀況與檢查報告.md》《牽關-後端串接文件.md》
> 狀態：已與使用者對過方向，待實作

## 目標

讓使用者可以用 Discord 帳號一次登入，看到自己所有企劃（開設者身分）與所有角色（含在別人企劃裡認領的角色）的清單，不用分別記住每個企劃/角色的編輯碼。

**核心判斷（已與使用者確認）**：
- Discord 只能用來「找回」已經證明過所有權的憑證，不能繞過所有權證明——連結永遠是「已經用編輯碼／開設者碼驗證過身分之後」才能發生的動作。
- 貼碼救援（TokenGate 貼編輯碼）永久保留、完全不動，Discord 是額外選項不是取代。
- 這條路徑完全不碰 `requireOwner`/`requireChar`/CSRF/速率限制/Turnstile——這些是既有、已經上線驗證過的安全機制，本功能只是在「怎麼拿到 cookie」這一步之前多加一種方法，拿到 cookie 之後，後面所有既有邏輯原封不動。

## 資料模型

新表 `user_links`（Drizzle schema 新增，D1 migration）：

| 欄位 | 型別 | 說明 |
|---|---|---|
| id | integer pk autoincrement | |
| discord_id | text not null | Discord snowflake，**不存 username／avatar**（見「隱私」一節） |
| kind | text not null | `'owner'` \| `'char'` |
| project_id | text not null, FK projects.id | |
| char_id | text, FK characters.id | 只有 `kind='char'` 時有值 |
| encrypted_token | text not null | AES-GCM 密文（見「權杖加密」一節） |
| created_at | integer not null | |

索引：**不能**用單一個 `UNIQUE(discord_id, kind, project_id, char_id)`——`kind='owner'` 的列 `char_id` 是 NULL，SQL 的 NULL 在唯一性比對裡永遠不等於 NULL，這個組合實際上擋不住重複的 owner 連結。改用兩條部分索引（partial unique index，SQLite 支援 `WHERE`）：

```sql
CREATE UNIQUE INDEX idx_links_owner ON user_links(discord_id, project_id) WHERE kind = 'owner';
CREATE UNIQUE INDEX idx_links_char  ON user_links(discord_id, char_id)    WHERE kind = 'char';
```

角色那條不用帶 `project_id` 也能唯一——`characters.id` 本身是全庫唯一的 CSPRNG 短碼（`genCharIdUnique()` 檢查的是整張表不分企劃），`project_id` 欄位只是方便查詢用的冗餘欄位，不用進唯一鍵。另加 `INDEX(discord_id)`（登入時查全部連結）。

**不使用**既有的 `projects.owner_discord_id` / `characters.discord_id` 保留欄位——那是給另一種「一格對一個 Discord ID」的窄設計（使用者選了現在這個「一個 Discord 帳號對多筆」的方向後，用一張多對多表更合適，單一保留欄位放不下一人多連結）。這兩個保留欄位維持原樣不動，本功能不寫入也不讀取，避免不相關的 migration。

## 隱私：不存 Discord username／avatar

`user_links` 只存 `discord_id`，OAuth callback 從 Discord `/users/@me` 拿到的 username／avatar／discriminator 等欄位**用完即丟，不寫進任何持久化儲存**（包含不進 log）。

原因：這個社群普遍刻意把 Discord 帳號和同人角色身分分開。存 username/avatar 等於在資料庫裡建一張「Discord 帳號 ↔ OC 角色」的對照表，這對這個使用者群體是最敏感的外洩內容之一。儀表板只顯示「已連結 Discord」的狀態與所連結的企劃/角色名稱，不顯示是哪個 Discord 帳號、哪個使用者名稱。

## 權杖加密（威脅模型變化，記錄在案）

`encrypted_token` 用 AES-GCM 加密，金鑰是新的 Workers secret `LINK_KEY`（32 bytes 隨機值，`wrangler secret put LINK_KEY`，永不進 git、永不進 D1）。用 HKDF 從 `LINK_KEY` 衍生兩把子金鑰，分開兩種用途避免同一把原始金鑰材料兩處重用：
- 子金鑰 A：AES-GCM 加密 `encrypted_token`
- 子金鑰 B：HMAC 簽章 `kg_u` cookie（見下）

**這是本專案安全模型第一次出現「可還原」的權杖儲存，必須明確記錄**：

規格 §6／既有安全報告的核心原則是「DB 只存 SHA-256 hash，權杖明文只在簽發當下出現一次，之後永遠拿不回來」——單純 DB 外洩（SQL injection、備份外流、內部存取）不會讓攻擊者拿到任何可用的權杖。

`user_links.encrypted_token` 打破了這個「純雜湊」的絕對性：只要同時取得（D1 資料庫內容）＋（`LINK_KEY` 這個 Workers secret），就能解密還原出原始 `own_`/`chr_` 權杖，等同直接取得那個企劃/角色的完整編輯權。這是刻意的取捨，不是疏漏：

- **為什麼要這樣做**：Discord 登入要能一次恢復使用者所有已連結的項目、且不能每次登入都讓其他裝置的既有 session 失效（多裝置情境常見，尤其上一輪剛做完手機優先的編輯 UX），純雜湊做不到「登入時重新簽發同一把 cookie」——雜湊是單向的。
- **為什麼可以接受**：兩把金鑰材料要同時外洩才有事（D1 內容外洩不夠，還要 Workers secret 一起外洩）；最壞後果是攻擊者能改別人的 OC 設定／企劃內容，沒有金流或個資規模的損失。
- **殘留風險**：`LINK_KEY` 本身變成單點——外洩等同外洩所有已連結項目的完整編輯權。跟 `TURNSTILE_SECRET`/`DISCORD_CLIENT_SECRET` 一樣走 `wrangler secret put`，不進任何檔案；沒有額外的金鑰輪替機制（v1 不做，需要輪替時得重新加密全表，先記錄這個限制）。

## 流程一：首次連結（唯一需要跳出 OAuth 的時刻）

只能從**已經用既有方式驗證過**的頁面觸發——企劃後台（Manage.tsx，已憑 `kg_o_` 進來）或角色頁（CharEdit.tsx/Relations.tsx，已憑 `kg_c_` 進來）上的「連結 Discord」按鈕。

1. 使用者點按鈕 → `GET /api/auth/discord/login?slug=<slug>&charId=<charId?>`
2. 後端產生一個隨機不可猜測的 `state_id`（如 20 bytes CSPRNG），寫入新的 KV binding `OAUTH_STATE`：`{ mode: 'link', slug, charId?, projectId, charDbId? }`，TTL 5 分鐘。
3. 轉址到 Discord 的 authorize URL，帶上 `state=<state_id>`，scope=`identify`。
4. 使用者在 Discord 同意後，Discord 轉回 `/api/auth/discord/callback?code=...&state=<state_id>`。
5. 後端：
   - 從 `OAUTH_STATE` 讀 `state_id`（讀到就立刻刪除——見「state 防護」一節）；讀不到（過期或已用過）就整個流程失敗，導回一個通用錯誤頁。
   - 用 `code` 跟 Discord 換 access token（`DISCORD_CLIENT_ID` + `DISCORD_CLIENT_SECRET`），再用 access token 打 `/users/@me` 拿 `discord_id`（只取這一個欄位）。
   - 重新驗證這個請求現在還帶著有效的 `kg_o_<projectId>`（mode link + 無 charId）或 `kg_c_<projectId>` 且該權杖 hash 對得上 `charDbId`（mode link + 有 charId）——**直接重用既有的 `requireOwner`/`requireChar`**，不重寫驗證邏輯。驗證失敗就整個流程失敗（避免有人在連結途中把 cookie 清掉還硬要連結）。
   - 驗證通過的話，這個請求裡本來就有那把 cookie 的明文（httpOnly 只擋前端 JS 讀，伺服器端讀 header 本來就讀得到）——用它加密後 upsert 進 `user_links`。
   - 簽發 `kg_u` cookie（見下）。
   - 轉址回**從 KV 讀到的 state 內容自己組出來的路徑**（`/p/<slug>/manage` 或 `/p/<slug>/c/<charId>`），絕不接受 callback 請求上任何額外的轉址參數（見「開放轉址防護」）。

## 流程二：登入後自動收錄（不用再跳 OAuth）

這是使用者提出的關鍵修正：**逐項綁定的原設計會讓人第二次卡在「我不是登入了嗎」的困惑**，改成——

只要瀏覽器上已經有效的 `kg_u`（代表這個裝置這個瀏覽器已經連過一次 Discord），之後任何一個會發出新的 `kg_o_`/`kg_c_` cookie 的既有端點，都在原本設定 cookie 那一步之後，**靜默**多做一次「若 `kg_u` 存在就 upsert `user_links`」。不用按鈕、不用 OAuth、使用者無感：

- `POST /api/projects`（建新企劃）
- `POST /api/p/:slug/owner-session`（貼開設者碼救援）
- `POST /api/p/:slug/join`（加入企劃、建新角色）
- `POST /api/p/:slug/c/:charId/session`（貼編輯碼救援）
- `POST /api/p/:slug/c/:charId/draft-char`（已持有本企劃某角色權杖時再開一隻）

這五個端點目前都已經有 `c.header('Set-Cookie', r.cookie, ...)` 這一步，加一個共用 helper（例如 `maybeAutoLink(c, kind, projectId, charId, rawToken)`）在後面呼叫：讀 `kg_u`（驗證其 HMAC 簽章合法），合法就用同一把 `LINK_KEY` 衍生金鑰加密 `rawToken`，upsert 進 `user_links`。整個動作在回傳回應前 `await` 完成，不用 `waitUntil`（單筆 upsert 延遲可忽略，換取正確性簡單）。

使用者第一次連結後，之後每加入一個新企劃／認領一個新角色／換裝置貼碼救援，都會自動被收進 Discord 帳號底下的清單——符合「我已經登入了」的直覺。

## 流程三：新裝置登入（恢復所有已連結項目）

跟流程一共用同一組端點，差別在 `state` 的 `mode`：

1. 使用者在**任何頁面**（不需要先有既有 cookie）點「用 Discord 登入」→ `GET /api/auth/discord/login`（不帶 slug/charId）。
2. `OAUTH_STATE` 寫入 `{ mode: 'restore' }`，其餘同流程一步驟 2–4。
3. Callback 驗證 state、換 token、拿 `discord_id` 後（同流程一）：
   - 因為 `mode='restore'` 不需要重新驗證既有 cookie（本來就沒有）。
   - 查 `user_links WHERE discord_id = ?` 全部列出。
   - 對每一列：解密 `encrypted_token`。**注意**：`charCookieLine()` 現有的合併邏輯（同企劃多角色用 `.` 接成一個 cookie 值）是讀「這次請求帶進來的 cookie header」去併新舊權杖——這個假設在平常「一次只加一隻新角色」的情境成立，但 restore 一次可能要恢復同一個 `project_id` 底下的好幾隻角色，這時如果對每一列各自呼叫一次 `charCookieLine()` 再各自 `append` 一個 `Set-Cookie`，會產生同名 cookie 的多個 `Set-Cookie` 標頭，瀏覽器只會留下其中一個，其餘角色的權杖就遺失了。restore 流程要先在記憶體裡把同 `project_id` 的角色權杖依 `.` 合併成一個字串，每個 `project_id` 只送一個 `kg_c_<projectId>` cookie；`kg_o_<projectId>`（開設者）本來就每企劃最多一列，不會遇到這個問題。
   - 全部 `append` 進回應（一次登入拿回所有企劃/角色的存取）。
   - 簽發 `kg_u`。
   - 轉址到 `/dashboard`（固定路徑，state 不帶任何自訂轉址目標）。

## 流程四：解除連結

`DELETE /api/me/links/:id`：讀 `kg_u`（驗證 HMAC），確認該 `user_links` 列的 `discord_id` 跟 `kg_u` 解出來的 `discord_id` 相符才能刪；不符一律 404（不透露列存在與否，統一風格）。刪除只影響「這個 Discord 帳號的清單」與「之後這個裝置對這個項目還會不會自動收錄」，**不影響**底層 `owner_token_hash`/`edit_token_hash`，不強制登出任何正在用該 cookie 的分頁（v1 不做 cookie 主動撤銷）。

## `kg_u` cookie 設計

不直接把明文 `discord_id` 放進 cookie（雖然 httpOnly，前端 JS 讀不到，但為了跟現有「cookie 只放不可偽造的值」慣例一致，且要防止有人手動偽造 `kg_u` 去誘發自動收錄把自己的權杖塞進別人帳號）：

```
kg_u = <discord_id>.<hmac_hex>
hmac_hex = HMAC-SHA256(discord_id, 子金鑰B)
```

`HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=15552000`（180 天，跟既有 cookie 一致）。伺服器讀取時先驗 HMAC 對不對，不對就當沒有這個 cookie（不觸發自動收錄、儀表板顯示未登入）。

## state 防護：一次性 + 不可偽造 + 無開放轉址

使用者提的兩點都要滿足，選擇「KV 存不可猜測亂數 id」這一種機制同時滿足兩者，不需要額外簽章：

- **不可偽造**：`state_id` 本身是高熵 CSPRNG（≥ 20 bytes），沒被寫進 KV 的值不可能通過查找——等同簽章的效果，猜不到就是假的。
- **一次性**：callback 讀到就立刻從 KV 刪除；同一個 `state_id` 第二次用一定查不到 → 拒絕。KV 的 TTL（5 分鐘）是保險，不是主要防線（正常流程幾秒內就會消耗掉）。
- **無開放轉址**：callback 完成後轉址去哪裡，只從 KV 裡存的 `{mode, slug, charId}` 由後端自己組字串決定（`mode=link` → `/p/<slug>/manage` 或 `/p/<slug>/c/<charId>`；`mode=restore` → 固定 `/dashboard`），**不接受、不讀取** callback request 上任何額外的 query 參數當轉址目標。

## 需要新增的基礎設施

- Workers secret：`LINK_KEY`（`wrangler secret put`）
- KV namespace：新建一個（如 `oauth-state`），`wrangler.jsonc` 加 `kv_namespaces: [{ binding: "OAUTH_STATE", id: "<建立後回填>" }]`
- D1 migration：`user_links` 表（`0002_user_links.sql`）
- 既有 `DISCORD_CLIENT_ID`（已在 `wrangler.jsonc` vars）／`DISCORD_CLIENT_SECRET`（已 `wrangler secret put`）沿用，不用重新申請

## 不動的部分

- `requireOwner`/`requireChar`/`csrfGuard`/`rateLimitGuard`/Turnstile：零修改。
- TokenGate 貼碼救援：完全不動，永久保留，Discord 純附加。
- `projects.owner_discord_id`/`characters.discord_id`：保留但本功能不使用。

## v1 明確排除範圍

- 共同管理者邀請 UI（資料表結構上允許一個企劃對多個 Discord 帳號各自連結，但不做「邀請別人加入管理」的介面）
- `LINK_KEY` 金鑰輪替機制
- 儀表板以外的 Discord 身分展示（不顯示 username/avatar，如「隱私」一節）

## 相關文件修正（已一併完成）

《牽關-後端串接文件.md》第一節的 cookie 簽發範例是舊版 SvelteKit 規劃時期寫的，`path: \`/p/${slug}\`` 這行是錯的——已改成對照實際 `api/src/auth/guard.ts` 實作的 `Path=/api/p/${slug}`，並加註解說明為什麼 `/p/<slug>` 會讓瀏覽器不送 cookie 到 `/api/p/<slug>/*`。這件事不等本功能實作，已經直接修正。
