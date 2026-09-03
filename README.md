# 牽關（Qianguan）

多人 OC（原創角色）企劃牽線站——開一個企劃、邀角色加入、在角色之間「牽線」建立關係，公開頁展示動態牆與名單。

- **前端**：`app/web` — React 19 + Vite 7 + TypeScript + Tailwind 3.4，hash routing
- **後端**：`app/api` — Hono on Cloudflare Workers + D1（Drizzle ORM）+ Zod
- **上線**：https://qianguan.beibeiz.workers.dev

## 開發

```bash
# 前端
cd app/web && npm install && npm run dev

# 後端
cd app/api && npm install --legacy-peer-deps
npm run db:apply:local   # 本機 D1 migration
npm run dev              # wrangler dev
npm test                 # relation.ts 狀態機測試（vitest + 真實 D1）
```

## 部署

```bash
cd app/web && npm run build   # 產出 app/web/dist，Worker 的 assets binding 會服務這份檔案
cd ../api && npm run deploy
```

部署前需要：
- `wrangler d1 create qianguan`，把回傳的 `database_id` 填進 `app/api/wrangler.jsonc`，再 `npm run db:apply`
- 建立 Cloudflare Turnstile widget，`wrangler secret put TURNSTILE_SECRET`（後端），`app/web/.env.production` 設 `VITE_TURNSTILE_SITEKEY`（照 `.env.production.example`）

安全模型（httpOnly cookie 權杖、CSRF、CSP、速率限制等）與規格對照的完整現況，見 [`牽關-實際狀況與檢查報告.md`](./牽關-實際狀況與檢查報告.md)；後端 API 對照表與遷移步驟見 [`牽關-後端串接文件.md`](./牽關-後端串接文件.md)。
