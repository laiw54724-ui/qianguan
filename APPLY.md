# 手機編輯 UX（P0–P1）套用說明

這包是針對 https://github.com/laiw54724-ui/qianguan 的前端＋後端改動。
Grok 沙盒沒有你的 GitHub 登入，所以沒辦法直接 git push。請下載後在你的電腦套用並推上去。

## 這次做了什麼

- 角色卡／世界觀編輯：填寫 與 組版 分開；手機預設填寫
- 複雜欄位改「點進去編」（全螢幕 sheet），底欄儲存跟著鍵盤
- 建立／編輯企劃與角色可貼連結 → 自動辨識 FB / IG / Threads / 噗浪 / Google… 顯示成 logo＋名稱晶片
- 開設者後台改成「資訊 · 世界 · 欄位 · 名單」分頁；分類詞庫（陣營／種族）可給角色與問答用
- 後端新增 links / tag_groups / tags JSON 欄，以及 /api/link-preview（抓網頁標題當預設顯示名稱）

牽線頁（Relations）這次沒改。預覽裡的「空位角色 slot」是沙盒才有的功能，沒打進這包。

## 套用

在你已經 clone 好的 repo 根目錄：

```bash
# 方式 A：有 patch 檔
git apply qianguan-p0p1.patch
git add -A
git commit -m "手機編輯 UX：填寫/組版拆開、連結晶片、分類標籤"
git push

# 方式 B：把 zip 裡的 app/ 整份覆到 repo 的 app/
```

然後部署（先跑 migration，再 deploy）：

```bash
cd app/web && npm install && npm run build
cd ../api
npm run db:apply          # 遠端 D1：加上 links / tag_groups / tags
npm run deploy
```
