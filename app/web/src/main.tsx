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
