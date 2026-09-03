import { env } from 'cloudflare:test';
// ?raw：Vite 在 bundle 時把檔案內容內聯成字串，避開 Workers runtime 沙盒裡沒有真實檔案系統的問題。
import raw from '../drizzle/0000_init.sql?raw';

// 直接 exec migration SQL，不依賴 vitest-plugin 的 D1 migration helper（該 API 在套件改版間還在變動）。
// D1Database.exec() 一列一個 statement，所以要先去掉註解、按 `;` 切開每條語句，各自壓成單行，再用換行接回去。
const withoutComments = raw
  .split('\n')
  .map((line: string) => line.replace(/--.*$/, ''))
  .join('\n');
const statements = withoutComments
  .split(';')
  .map((s: string) => s.replace(/\s+/g, ' ').trim())
  .filter(Boolean);
await env.DB.exec(statements.join('\n'));
