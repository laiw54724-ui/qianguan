import { env } from 'cloudflare:test';

// 直接 exec 每個 migration SQL，不依賴 vitest-plugin 的 D1 migration helper（該 API 在套件改版間還在變動）。
// import.meta.glob(..., { query: '?raw' })：Vite 在 bundle 時把每個檔案內容內聯成字串，
// 避開 Workers runtime 沙盒裡沒有真實檔案系統的問題；eager+按檔名排序＝照 migration 順序套用。
const modules = import.meta.glob('../drizzle/*.sql', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

// D1Database.exec() 一列一個 statement，所以要先去掉註解、按 `;` 切開每條語句，各自壓成單行，再用換行接回去。
function toExecStatements(raw: string): string {
  const withoutComments = raw
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
  return withoutComments
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

for (const path of Object.keys(modules).sort()) {
  const statements = toExecStatements(modules[path]);
  if (statements) await env.DB.exec(statements);
}
