import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  // 絕對路徑：path routing 下同一份 index.html 會從任意深度的路徑（/p/xxx/c/yyy）送出，
  // 相對路徑（原本的 './'）在深路徑下會解析錯位置（瀏覽器會拿掉網址最後一段當「目錄」），
  // 資源整批 404。這在 hash 路由時代不會被發現，因為唯一會用到深路徑的地方（§11 OG meta
  // 的 /p/:slug 路由）只服務爬蟲，爬蟲不執行 JS/CSS，而真人瀏覽器一律被轉址回 / 再載入。
  base: '/',
  plugins: [inspectAttr(), react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
