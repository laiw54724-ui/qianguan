import { useEffect, useId, useMemo, useRef, useState, type FocusEvent, type FormEvent, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { href, installLinkNavigation } from '../lib/nav';
import { getPendingPath, resolveLeave, subscribeLeaveGuard } from '../lib/dirty';

// ---------- 頭像 ----------
// 無上傳圖時：依角色名生成專屬色塊頭像（品牌雙圓／幾何塊，與 logo 同源）
const AVATAR_INKS = ['#9E4B2C', '#7FC0DC', '#24697F', '#F5AEBD'];

// 名字 → 兩個獨立雜湊，組合出 6 種構圖 × 墨色 × 位置/大小變化，避免撞臉
function blockAvatar(name: string): string {
  let h1 = 2166136261;
  let h2 = 5381;
  for (const ch of name) {
    const c = ch.codePointAt(0) ?? 0;
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = (Math.imul(h2, 33) ^ c) >>> 0;
  }
  h1 = (h1 ^ (h1 >>> 13)) >>> 0; // 保持無號，避免負數取模全部掉進同一構圖
  h2 = (h2 ^ (h2 >>> 15)) >>> 0;
  const a = AVATAR_INKS[h1 % AVATAR_INKS.length];
  let b = AVATAR_INKS[(h2 >> 3) % AVATAR_INKS.length];
  if (b === a) b = AVATAR_INKS[(h1 + 2) % AVATAR_INKS.length];
  const dark = '#1D251B';
  const paper = '#FBF8F3';
  const dx = ((h2 >> 6) % 17) - 8; // -8..8
  const dy = ((h2 >> 11) % 13) - 6; // -6..6
  const r1 = 26 + (h1 >> 5) % 8; // 26..33
  const r2 = 20 + (h2 >> 8) % 9; // 20..28
  const w1 = 44 + (h1 >> 9) % 24; // 44..67
  const rot = (h2 % 40) - 20;
  const v = h1 % 6;
  let body = '';
  if (v === 0) {
    // 品牌雙圓交疊（位置、距離、角度隨機）
    const d = 16 + (h2 >> 14) % 12; // 圓心距 16..27
    const cy = 50 + dy;
    const hy = Math.sqrt(Math.max(4, r1 * r1 - (d / 2) * (d / 2)));
    const lens = `M ${50 + dx},${cy - hy} A ${r1},${r1} 0 0,1 ${50 + dx},${cy + hy} A ${r1},${r1} 0 0,1 ${50 + dx},${cy - hy} Z`;
    body = `<g transform='rotate(${rot} 50 50)'><circle cx='${50 + dx - d / 2}' cy='${cy}' r='${r1}' fill='${a}'/><circle cx='${50 + dx + d / 2}' cy='${cy}' r='${r1}' fill='${b}'/><path d='${lens}' fill='${dark}'/></g>`;
  } else if (v === 1) {
    // 方塊＋圓
    body = `<g transform='rotate(${rot} 50 50)'><rect x='${14 + dx}' y='${14 + dy}' width='56' height='56' fill='${b}'/></g><circle cx='${62 + dx}' cy='${62 + dy}' r='${r2}' fill='${a}'/>`;
  } else if (v === 2) {
    // 雙橫條＋小圓
    const bh = 17 + (h1 >> 3) % 7;
    body = `<rect x='10' y='${22 + dy}' width='${w1 + 20}' height='${bh}' fill='${a}'/><rect x='10' y='${56 + dy}' width='${w1}' height='${bh - 3}' fill='${b}'/><circle cx='${72 + dx}' cy='${64 + dy}' r='11' fill='${dark}'/>`;
  } else if (v === 3) {
    // 大圓環＋實心小圓
    body = `<circle cx='${50 + dx}' cy='${50 + dy}' r='${r1 + 6}' fill='none' stroke='${a}' stroke-width='13'/><circle cx='${50 - dx}' cy='${50 - dy}' r='${r2 * 0.75}' fill='${b}'/><circle cx='${78 + dx * 0.5}' cy='${24}' r='6' fill='${dark}'/>`;
  } else if (v === 4) {
    // 斜切三角＋長條
    body = `<path d='M ${10 + dx} 88 L ${50 + dx} ${12 + dy} L ${90 + dx} 88 Z' fill='${a}'/><rect x='${18}' y='${72 + dy}' width='64' height='11' fill='${b}'/><circle cx='${50 + dx}' cy='${52}' r='8' fill='${paper}'/>`;
  } else {
    // 半圓＋直條
    body = `<path d='M ${20 + dx} ${68 + dy} A ${r1} ${r1} 0 0 1 ${80 + dx} ${68 + dy} Z' fill='${a}'/><rect x='${66 + dx * 0.4}' y='12' width='13' height='${52 + dy}' fill='${b}'/><circle cx='${28}' cy='${24 + dy}' r='7' fill='${dark}'/>`;
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='${paper}'/>${body}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function CharAvatar({ name, url, size = 44 }: { name: string; url?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const fallback = useMemo(() => blockAvatar(name), [name]);
  return (
    <img
      src={url && !broken ? url : fallback}
      alt={name}
      onError={() => setBroken(true)}
      style={{ width: size, height: size }}
      className="rounded-full border-2 border-[#e8dfd4] object-cover shrink-0"
    />
  );
}


// ---------- 離開守衛 modal（規格 §12-4）：要儲存變更嗎？／儲存／捨棄／取消 ----------
export function LeaveGuardHost() {
  const [, force] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => subscribeLeaveGuard(() => force((x) => x + 1)), []);
  useEffect(() => installLinkNavigation(), []);
  const pending = getPendingPath();
  if (!pending) return null;
  return (
    <div className="fixed inset-0 z-[80] bg-[#33261e]/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label="未儲存的變更" className="kg-card w-full max-w-sm p-6 space-y-4">
        <div className="font-huninn text-xl">有未儲存的變更</div>
        <p className="text-sm text-[#6f6156] leading-relaxed">離開前要儲存嗎？未儲存的內容在這台裝置上還有備份，但其他人要等你儲存才看得到。</p>
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            className="kg-pill kg-pill-red"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await resolveLeave('save');
              setBusy(false);
            }}
          >
            {busy ? '儲存中…' : '儲存並離開'}
          </button>
          <button type="button" className="kg-pill kg-pill-ghost" disabled={busy} onClick={() => resolveLeave('discard')}>
            捨棄
          </button>
          <button type="button" className="kg-pill kg-pill-ghost" disabled={busy} onClick={() => resolveLeave('cancel')}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Toast 回饋 ----------
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

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    const push = (t: ToastItem) => {
      setItems((xs) => [...xs.slice(-2), t]); // 最多同時 3 則
      timers.set(
        t.id,
        setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 2600),
      );
    };
    toastListeners.add(push);
    return () => {
      toastListeners.delete(push);
      timers.forEach(clearTimeout);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[70] w-[min(92vw,24rem)] -translate-x-1/2 space-y-2" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`kg-toast ${t.kind === 'err' ? 'kg-toast-err' : ''}`}>
          {t.kind === 'err' ? '✕ ' : '✓ '}
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ---------- 載入動畫 ----------
export function PageLoading({ text = '載入中…' }: { text?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4" role="status" aria-live="polite">
      <img src="/logo-mark.svg" alt="" className="kg-pulse h-12 w-12" />
      <div className="h-1 w-40 overflow-hidden rounded-full bg-[#e8dfd4]">
        <div className="kg-progress-ind h-full w-1/3 rounded-full bg-[#9e4b2c]" />
      </div>
      <p className="font-mono2 text-xs text-[#6f6156]">{text}</p>
    </div>
  );
}

// 換頁時的頂部細進度條（hash 路由沒有瀏覽器原生進度提示）
// 1-2：字寬跟著 useTransition 的 isPending 走，不是固定時間的假動畫——
// 真的還在等（換頁本身、或頁面元件初次資料還沒回來）才有進度條，等到了立刻補滿收掉。
export function RouteProgress({ isPending }: { isPending: boolean }) {
  const [show, setShow] = useState(false);
  const [w, setW] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isPending) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setShow(true);
      setW(18);
      const t = setTimeout(() => setW(72), 80);
      return () => clearTimeout(t);
    }
    if (!show) return;
    setW(100);
    hideTimer.current = setTimeout(() => {
      setShow(false);
      setW(0);
    }, 200);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending]);

  if (!show) return null;
  return <div className="kg-routebar" style={{ width: `${w}%` }} aria-hidden="true" />;
}

// ---------- 紅線（兩點之間） ----------
export function ThreadLink({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 20" className={className} aria-hidden style={{ overflow: 'visible' }}>
      <path
        d="M2 12 C 12 2, 20 20, 26 10 S 40 2, 46 10"
        fill="none"
        stroke="#a8455e"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="0"
      />
      <circle cx="2" cy="12" r="3" fill="#a8455e" />
      <circle cx="46" cy="10" r="3" fill="#a8455e" />
    </svg>
  );
}

// ---------- 括號節標籤 ----------
export function SecLabel({ children }: { children: ReactNode }) {
  return <div className="kg-seclabel">（{children}）</div>;
}

// ---------- 頁首 ----------
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b-2 border-[#e8dfd4] bg-[#fbf8f3]/95 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
        <a href={href('/')} className="flex items-center gap-2.5 group">
          <img src="/logo-mark.svg" alt="" className="w-8 h-8 group-hover:scale-110 transition-transform" />
          <span className="font-logo text-xl group-hover:text-[#9e4b2c] transition-colors">
            牽關
          </span>
        </a>
        <nav className="flex items-center gap-2 sm:gap-3">
          <a href={href('/home')} className="kg-pill kg-pill-ghost kg-pill-sm">
            首頁
          </a>
          <a href={href('/new')} className="kg-pill kg-pill-red kg-pill-sm">
            ＋ 建立企劃
          </a>
        </nav>
      </div>
    </header>
  );
}

// ---------- 頁尾 ----------
export function SiteFooter() {
  return (
    <footer className="mt-20 border-t-2 border-[#e8dfd4] py-8">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between text-sm text-[#6f6156]">
        <div className="font-logo text-[#33261e]">牽關 ✦ 牽一線，繫一緣</div>
        <div className="font-mono2 text-xs">無帳號・權杖認證 ｜ 前端 Demo：資料僅存於此瀏覽器</div>
      </div>
    </footer>
  );
}

// ---------- 跑馬燈分隔帶 ----------
export function Marquee({ items }: { items: string[] }) {
  const row = items.map((t, i) => (
    <span key={i} className="mx-6 font-bold text-sm whitespace-nowrap text-[#8a3f23]">
      {t}
      <span className="mx-6 text-[#a8455e]">✦</span>
    </span>
  ));
  return (
    <div className="overflow-hidden border-y border-[#e8dfd4] bg-[#e9f3f9] py-2.5 select-none">
      <div className="kg-marquee-track">
        <div className="flex">{row}</div>
        <div className="flex" aria-hidden>
          {row}
        </div>
      </div>
    </div>
  );
}

// ---------- Turnstile 正式元件 ----------
// 規格 §6.7：三處掛載（建立企劃／加入企劃／發起牽線）。VITE_TURNSTILE_SITEKEY 有設定時載入
// 真正的 Cloudflare Widget 並把 cf-turnstile-response token 交給呼叫端；沒設定（本機開發）時
// 不渲染元件，直接以 'dev-bypass' 當 token——這個 fallback 只在後端也沒設 TURNSTILE_SECRET 時
// 才會真的放行，兩邊必須同步，見《後端串接文件》第二節。呼叫端可用 TURNSTILE_REQUIRED 判斷
// 目前是否真的需要使用者完成驗證（本機開發沒設 sitekey 時免驗）。
declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

const TURNSTILE_SITEKEY = (import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined) || '';
let turnstileScriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!turnstileScriptPromise) {
    turnstileScriptPromise = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      el.async = true;
      el.defer = true;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error('turnstile script load failed'));
      document.head.appendChild(el);
    });
  }
  return turnstileScriptPromise;
}

export const TURNSTILE_REQUIRED = Boolean(TURNSTILE_SITEKEY);

export function TurnstileWidget({ token, onChange }: { token: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!TURNSTILE_SITEKEY) {
      if (!token) onChange('dev-bypass');
      return;
    }
    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(ref.current, {
          sitekey: TURNSTILE_SITEKEY,
          callback: (t: string) => onChange(t),
          'expired-callback': () => onChange(''),
          'error-callback': () => onChange(''),
        });
      })
      .catch(() => onChange(''));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!TURNSTILE_SITEKEY) return null;
  return <div ref={ref} />;
}

// ---------- 權杖揭示 ----------
export function TokenReveal({
  kind,
  token,
  note,
  children,
}: {
  kind: 'owner' | 'char';
  token: string;
  note?: string;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  // 1-4：手機上按複製、切去 Discord 貼連結，剪貼簿常被蓋掉——勾了才能繼續，
  // 逼使用者在離開這個畫面前，實際確認自己已經存好（抄下來／截圖／存進密碼管理器都算）。
  const [confirmed, setConfirmed] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = token;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="kg-card p-6 sm:p-8 kg-rise">
      <div className="flex items-center gap-3 mb-4">
        <span className="kg-tag" style={{ background: '#7fc0dc' }}>
          只顯示這一次
        </span>
        <h2 className="font-huninn text-xl">
          {kind === 'owner' ? '開設者碼' : '角色編輯碼'}
        </h2>
      </div>
      <p className="text-sm text-[#6f6156] mb-4 leading-relaxed">
        {kind === 'owner'
          ? '這是管理此企劃的唯一憑證。遺失後無法找回，請立即抄下保存。'
          : '這是編輯此角色、發起與回應牽線的唯一憑證。遺失後無法找回，請立即抄下保存。'}
      </p>
      <div className="kg-token-box">{token}</div>
      <div className="flex flex-wrap gap-3 mt-5">
        <button type="button" className="kg-pill kg-pill-ink" onClick={copy}>
          {copied ? '✓ 已複製' : '複製權杖'}
        </button>
      </div>
      <label className="flex items-center gap-2.5 text-sm font-bold cursor-pointer select-none mt-5 pt-5 border-t border-dashed border-[#e8dfd4]">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="w-5 h-5 accent-[#9e4b2c]" />
        我已經存好了
      </label>
      <div
        className={`flex flex-wrap gap-3 mt-4 transition-opacity ${confirmed ? '' : 'opacity-40 pointer-events-none'}`}
        aria-disabled={!confirmed}
      >
        {children}
      </div>
      {!confirmed && <p className="mt-2 text-xs text-[#a8455e]">＊ 先勾選「我已經存好了」才能繼續</p>}
      {note && <p className="mt-4 text-xs text-[#6f6156]">{note}</p>}
    </div>
  );
}

// ---------- 錯誤／空狀態 ----------
export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <div className="border-2 border-dashed border-[#6f6156]/50 rounded-2xl px-6 py-10 text-center text-[#6f6156] text-sm">
      {children}
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border-2 border-[#a8455e] bg-[#fcebf0]/40 px-4 py-3 text-sm font-bold text-[#a8455e]">
      {children}
    </div>
  );
}

/** IME-safe field: never feed composing text to React, never let React 19
 *  rewrite `defaultValue` mid-stroke (that was eating 注音 on create/join). */
function isComposingEvent(e: { nativeEvent: Event }) {
  const ne = e.nativeEvent as InputEvent & { isComposing?: boolean; keyCode?: number };
  return !!(ne.isComposing || ne.keyCode === 229);
}

function useImeBind<T extends HTMLInputElement | HTMLTextAreaElement>(
  value: string,
  onChange: (v: string) => void,
) {
  const ref = useRef<T>(null);
  const composing = useRef(false);
  const sent = useRef(value);
  const initial = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const el = ref.current;
    if (!el || composing.current) return;
    if (value === sent.current) return;
    sent.current = value;
    if (el.value !== value) el.value = value;
  }, [value]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = () => {
      composing.current = true;
    };
    const end = () => {
      composing.current = false;
      const v = el.value;
      sent.current = v;
      onChangeRef.current(v);
    };
    el.addEventListener('compositionstart', start);
    el.addEventListener('compositionend', end);
    return () => {
      el.removeEventListener('compositionstart', start);
      el.removeEventListener('compositionend', end);
    };
  }, []);

  const emit = (el: T) => {
    if (composing.current) return;
    const v = el.value;
    if (v === sent.current) return;
    sent.current = v;
    onChangeRef.current(v);
  };

  return {
    ref,
    initial: initial.current,
    onInput: (e: FormEvent<T>) => {
      if (isComposingEvent(e) || composing.current) return;
      emit(e.currentTarget);
    },
    onBlur: (e: FocusEvent<T>) => {
      composing.current = false;
      emit(e.currentTarget);
    },
  };
}

export function ImeInput({
  value,
  onChange,
  onBlur,
  onInput,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (v: string) => void;
}) {
  const ime = useImeBind<HTMLInputElement>(value, onChange);
  return (
    <input
      {...rest}
      ref={ime.ref}
      defaultValue={ime.initial}
      onInput={(e) => {
        ime.onInput(e);
        onInput?.(e);
      }}
      onBlur={(e) => {
        ime.onBlur(e);
        onBlur?.(e);
      }}
    />
  );
}

export function ImeTextarea({
  value,
  onChange,
  onBlur,
  onInput,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (v: string) => void;
}) {
  const ime = useImeBind<HTMLTextAreaElement>(value, onChange);
  return (
    <textarea
      {...rest}
      ref={ime.ref}
      defaultValue={ime.initial}
      onInput={(e) => {
        ime.onInput(e);
        onInput?.(e);
      }}
      onBlur={(e) => {
        ime.onBlur(e);
        onBlur?.(e);
      }}
    />
  );
}

// ---------- 權杖驗證閘門（貼上權杖以繼續） ----------
export function TokenGate({
  title,
  hint,
  token,
  setToken,
  onSubmit,
  busy,
  error,
}: {
  title: string;
  hint: string;
  token: string;
  setToken: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  error: string | null;
}) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = (await navigator.clipboard.readText()).trim();
        if (cancelled || token) return;
        if (/^(chr_|own_)/i.test(t)) setToken(t);
      } catch {
        /* 沒權限就讓人自己貼 */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pasteFromClipboard = async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (t) setToken(t);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mx-auto max-w-md kg-card p-6 sm:p-8 kg-rise">
      <h1 className="font-huninn text-2xl mb-2">{title}</h1>
      <p className="text-sm text-[#6f6156] mb-5 leading-relaxed">{hint}</p>
      <label htmlFor="fld-kg-1" className="kg-label">
        編輯碼 <span className="req">*</span>
      </label>
      <input
        id="fld-kg-1"
        className="kg-input font-mono2"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="貼上主辦給你的那串碼"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && token.trim()) onSubmit();
        }}
      />
      <button type="button" className="kg-pill kg-pill-ghost w-full justify-center mt-3 min-h-11" onClick={() => { void pasteFromClipboard(); }}>
        從剪貼簿貼上
      </button>
      {error && (
        <div className="mt-3">
          <ErrorBox>{error}</ErrorBox>
        </div>
      )}
      <button
        type="button"
        className="kg-pill kg-pill-red w-full justify-center mt-5"
        disabled={busy || !token.trim()}
        onClick={onSubmit}
      >
        {busy ? '驗證中…' : '進入'}
      </button>
    </div>
  );
}

export function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setInset(overlap);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return inset;
}

// 企劃頁殼（project-shell.tsx）的底部四格導覽是 fixed，跟這個 bar 搶同一個 bottom:0——
// 在殼裡用時傳 inShell，疊在導覽列上面，不要蓋住。導覽列高度含 env(safe-area-inset-bottom)，
// 這裡用 calc() 一起算，鍵盤彈出時 useKeyboardInset 的 inset 再疊上去。
export const SHELL_NAV_HEIGHT = 60; // 對應 project-shell.tsx 的 min-h-[56px] 項目 + 一點邊距
export const SAVEBAR_HEIGHT = 64; // .kg-savebar 的實際高度估值，給疊更上層的元件（如分享提示）算位置用

export function StickySaveBar({
  dirty,
  busy,
  onSave,
  saveLabel = '儲存',
  status,
  inShell,
}: {
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  saveLabel?: string;
  status?: string;
  inShell?: boolean;
}) {
  const inset = useKeyboardInset();
  const left = status ?? (busy ? '儲存中…' : dirty ? '● 未儲存' : '已同步');
  const bottom = inShell && inset === 0
    ? `calc(${SHELL_NAV_HEIGHT}px + env(safe-area-inset-bottom))`
    : inset;
  return (
    <div className="kg-savebar" style={{ bottom }}>
      <div className="mx-auto max-w-2xl flex items-center gap-3">
        <span className={`font-mono2 text-xs ${dirty ? 'text-[#9e4b2c]' : 'text-[#6f6156]'}`}>
          {busy ? '處理中…' : left}
        </span>
        <button
          type="button"
          className="kg-pill kg-pill-red ml-auto min-h-11 min-w-[5.5rem] justify-center"
          disabled={!dirty || busy}
          onClick={onSave}
        >
          {busy ? '處理中…' : saveLabel}
        </button>
      </div>
    </div>
  );
}

export function ChoiceSeg<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  ariaLabel: string;
}) {
  return (
    <div className="kg-seg kg-seg-grow" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function RowMenu({
  items,
}: {
  items: Array<{ label: string; onClick: () => void; danger?: boolean; disabled?: boolean }>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button type="button" className="kg-iconbtn" aria-expanded={open} aria-label="更多動作" onClick={() => setOpen((v) => !v)}>
        ⋯
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-20 cursor-default" aria-label="關閉選單" onClick={() => setOpen(false)} />
          <div className="kg-menu" role="menu">
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                className={`kg-menu-item ${it.danger ? 'text-[#a8455e]' : ''}`}
                onClick={() => {
                  it.onClick();
                  setOpen(false);
                }}
              >
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function FillSheet({ title, onDone, children }: { title: string; onDone: () => void; children: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div className="kg-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="kg-sheet-bar">
        <span className="font-bold flex-1 truncate">{title}</span>
        <button type="button" className="kg-pill kg-pill-red min-h-11" onClick={onDone}>
          完成
        </button>
      </div>
      <div className="kg-sheet-body">{children}</div>
    </div>
  );
}

export function FillSection({
  title,
  meta,
  open,
  onToggle,
  children,
}: {
  title: string;
  meta?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="kg-card-flat overflow-hidden">
      <button type="button" className="kg-acc-head" aria-expanded={open} onClick={onToggle}>
        <span className="font-bold flex-1 truncate text-left">{title}</span>
        {meta ? <span className="font-mono2 text-[10px] text-[#6f6156] shrink-0">{meta}</span> : null}
        <span className="kg-chevron text-[#6f6156]" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && <div className="p-4 space-y-4 border-t-2 border-[#e8dfd4]">{children}</div>}
    </div>
  );
}

// ---------- 圖片欄位：上傳（自動壓縮）或貼網址，附預覽 ----------
import { readImageFile, readMediaFile, readPdfFile } from '../lib/files';
import {
  checklistVisible,
  fieldHasContent,
  paletteVisible,
  parseChecklist,
  parseCsv,
  parsePalette,
  parseRadar,
  parseTimeline,
  radarVisible,
  stringifyChecklist,
  stringifyPalette,
  stringifyRadar,
  stringifyTimeline,
  timelineVisible,
} from '../lib/fvals';
import { uid } from '../lib/uid';
import type {
  BlockField,
  BlockFieldType,
  ChecklistItem,
  FieldDef,
  FieldStyle,
  FieldType,
  GalleryLayout,
  PaletteColor,
  QaItem,
  RadarDim,
  RelationExtra,
  TagGroup,
  TimelineEvent,
  WorldBlock,
} from '../lib/types';

export function ImageField({
  label,
  value,
  onChange,
  hint,
  square = false,
  compact = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  square?: boolean;
  compact?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  return (
    <div>
      <div className="flex items-center gap-1">
        <label className="kg-label flex-1 mb-0" htmlFor={inputId}>{label}</label>
        <RowMenu
          items={[
            { label: urlOpen ? '收起網址' : '貼上網址', onClick: () => setUrlOpen((v) => !v) },
            { label: '移除圖片', onClick: () => onChange(''), danger: true, disabled: !value },
          ]}
        />
      </div>
      <button
        type="button"
        className={`kg-drop mt-1.5 ${square ? 'kg-drop-sq' : ''} ${compact ? 'kg-drop-sm' : ''}`}
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        {value ? (
          <img src={value} alt="" />
        ) : (
          <span className="font-mono2 text-[11px] text-[#6f6156] px-2">{busy ? '處理中…' : '點擊上傳'}</span>
        )}
      </button>
      {urlOpen && (
        <input
          id={inputId}
          type="url"
          inputMode="url"
          className="kg-input font-mono2 text-xs mt-2"
          value={value.startsWith('data:') ? '' : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…"
        />
      )}
      {hint && <p className="font-mono2 text-[11px] text-[#6f6156] mt-1.5">{hint}</p>}
      {err && <p className="text-xs font-bold text-[#a8455e] mt-1">{err}</p>}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          setErr(null);
          try {
            onChange(await readImageFile(f));
          } catch (ex) {
            setErr(ex instanceof Error ? ex.message : '上傳失敗');
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

// ---------- 漂亮預覽：圖片（可翻頁）／PDF 燈箱 ----------
export function PreviewModal({
  block,
  startIndex = 0,
  onClose,
}: {
  block: { title: string; type: string; content: string; images?: string[]; fileName?: string } | null;
  startIndex?: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIndex);
  const boxRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 無障礙：Escape 關閉、焦點進 modal、Tab 困在 modal 內、關閉後焦點還原、鎖背景捲動
  // onClose 走 ref，避免父層重渲染讓 effect 重跑、焦點被反覆搶走
  useEffect(() => {
    if (!block) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const box = boxRef.current;
    box?.querySelector<HTMLElement>('button, [href], iframe, [tabindex]:not([tabindex="-1"])')?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !box) return;
      const items = Array.from(box.querySelectorAll<HTMLElement>('button, [href], iframe, input, [tabindex]:not([tabindex="-1"])')).filter((el) => !el.hasAttribute('disabled'));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus();
    };
  }, [block]);

  if (!block) return null;
  const images = block.images && block.images.length > 0 ? block.images : /^(data:image|https?:)/.test(block.content) && block.content ? [block.content] : [];
  const cur = Math.min(idx, Math.max(0, images.length - 1));
  return (
    <div
      className="fixed inset-0 z-50 bg-[#33261e]/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={block.title}
        className="kg-card w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-3.5 border-b-2 border-[#e8dfd4]">
          <span className="w-2 h-2 rounded-full bg-[#9e4b2c]" />
          <span className="font-huninn text-lg truncate">{block.title}</span>
          <span className="kg-tag shrink-0">{block.type === 'pdf' ? 'PDF' : '圖片'}</span>
          {block.type !== 'pdf' && images.length > 1 && (
            <span className="font-mono2 text-[11px] text-[#6f6156] shrink-0">
              {cur + 1} / {images.length}
            </span>
          )}
          {block.fileName && (
            <span className="font-mono2 text-[11px] text-[#6f6156] truncate">{block.fileName}</span>
          )}
          <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm ml-auto shrink-0" onClick={onClose}>
            關閉 ✕
          </button>
        </div>
        <div className="flex-1 overflow-auto bg-[#e8dfd4]/20 relative flex items-center justify-center p-4 min-h-[40vh]">
          {block.type === 'pdf' ? (
            // 安全：只有本站產生的 data:application/pdf 才放進 iframe；
            // 外部網址不嵌入（避免釣魚頁被包進站內），改給新分頁開啟
            block.content.startsWith('data:application/pdf') ? (
              <iframe src={block.content} title={block.title} className="w-full h-[70vh] rounded-lg bg-white" />
            ) : safeHttpUrl(block.content) ? (
              <div className="text-center space-y-3 py-10">
                <p className="text-sm text-[#6f6156]">外部 PDF 連結不站內預覽，請在新分頁開啟：</p>
                <a href={safeHttpUrl(block.content)!} target="_blank" rel="noreferrer noopener" className="kg-pill kg-pill-red inline-flex">
                  開啟 PDF ↗
                </a>
              </div>
            ) : (
              <p className="text-sm text-[#6f6156] py-10">無法預覽此文件。</p>
            )
          ) : (
            <>
              <img src={images[cur]} alt={`${block.title} ${cur + 1}`} className="max-w-full max-h-[68vh] rounded-lg object-contain" />
              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="上一張"
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-[#fbf8f3]/90 border-2 border-[#e8dfd4] font-bold text-[#9e4b2c] hover:border-[#9e4b2c]"
                    onClick={() => setIdx((cur - 1 + images.length) % images.length)}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    aria-label="下一張"
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-[#fbf8f3]/90 border-2 border-[#e8dfd4] font-bold text-[#9e4b2c] hover:border-[#9e4b2c]"
                    onClick={() => setIdx((cur + 1) % images.length)}
                  >
                    ›
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- 相簿呈現（企劃頁／角色頁共用）：輪播或縮圖 ----------
export interface PreviewTarget {
  title: string;
  type: string; // 'image' | 'pdf'
  content: string;
  images?: string[];
  fileName?: string;
}

export function GalleryView({
  title,
  content,
  images: imagesProp,
  layout,
  onPreview,
}: {
  title: string;
  content: string;
  images?: string[];
  layout?: GalleryLayout;
  onPreview: (t: PreviewTarget, i: number) => void;
}) {
  const images = imagesProp && imagesProp.length > 0 ? imagesProp : /^(data:image|https?:)/.test(content) && content ? [content] : [];
  const [idx, setIdx] = useState(0);
  if (images.length === 0) return null;
  const cur = Math.min(idx, images.length - 1);
  const open = (i: number) => onPreview({ title, type: 'image', content: images[i], images }, i);
  if (layout === 'carousel') {
    return (
      <div className="relative">
        <button type="button" className="block w-full" onClick={() => open(cur)}>
          <img
            src={images[cur]}
            alt={`${title} ${cur + 1}`}
            className="w-full max-h-96 object-cover rounded-lg border-2 border-[#e8dfd4] hover:border-[#9e4b2c] transition-colors"
          />
        </button>
        {images.length > 1 && (
          <>
            <button
              type="button"
              aria-label="上一張"
              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-[#fbf8f3]/90 border-2 border-[#e8dfd4] font-bold text-[#9e4b2c]"
              onClick={() => setIdx((cur - 1 + images.length) % images.length)}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="下一張"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-[#fbf8f3]/90 border-2 border-[#e8dfd4] font-bold text-[#9e4b2c]"
              onClick={() => setIdx((cur + 1) % images.length)}
            >
              ›
            </button>
            <div className="absolute bottom-2 right-3 font-mono2 text-[11px] bg-[#33261e]/70 text-[#fbf8f3] rounded-full px-2 py-0.5">
              {cur + 1} / {images.length}
            </div>
          </>
        )}
      </div>
    );
  }
  return (
    <div className={`grid gap-2 ${images.length === 1 ? 'grid-cols-1' : images.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
      {images.map((src, i) => (
        <button key={i} type="button" className="block group" onClick={() => open(i)}>
          <img
            src={src}
            alt={`${title} ${i + 1}`}
            className="w-full aspect-square object-cover rounded-lg border-2 border-[#e8dfd4] group-hover:border-[#9e4b2c] transition-colors"
          />
        </button>
      ))}
    </div>
  );
}

// ---------- 內容區塊編輯器（世界觀／角色卡共用） ----------
// 一個區塊＝一個容器，裡面可放多個自訂欄位；新增區塊時可套用模板
const BLOCKFIELD_TYPE_GROUPS: Array<{ group: string; items: Array<{ value: BlockFieldType; label: string }> }> = [
  { group: '文字', items: [{ value: 'text', label: '短文字' }, { value: 'textarea', label: '長文字' }] },
  {
    group: '選項・標籤',
    items: [
      { value: 'tags', label: '標籤' },
      { value: 'select', label: '單選' },
      { value: 'multiselect', label: '多選' },
      { value: 'checklist', label: '核取清單' },
    ],
  },
  {
    group: '數值・時間',
    items: [
      { value: 'number', label: '數字' },
      { value: 'date', label: '日期' },
      { value: 'rating', label: '評分' },
      { value: 'radar', label: '五維雷達' },
      { value: 'timeline', label: '時間線' },
      { value: 'calendar', label: '行事曆' },
    ],
  },
  {
    group: '色彩',
    items: [
      { value: 'color', label: '顏色' },
      { value: 'palette', label: '色票' },
    ],
  },
  {
    group: '媒體',
    items: [
      { value: 'image', label: '圖片（相簿）' },
      { value: 'audio', label: '音樂' },
      { value: 'video', label: '影片' },
      { value: 'pdf', label: 'PDF' },
    ],
  },
  {
    group: '連結・關係',
    items: [
      { value: 'url', label: '連結' },
      { value: 'charref', label: '關聯角色' },
    ],
  },
];

const DEFAULT_RADAR: RadarDim[] = [
  { label: '力量', value: 3 },
  { label: '敏捷', value: 3 },
  { label: '智力', value: 3 },
  { label: '體力', value: 3 },
  { label: '意志', value: 3 },
];

// 建立區塊欄位：雷達預填五個維度，其餘從空值開始
const newBlockField = (type: BlockFieldType, label = '', extra: Partial<BlockField> = {}): BlockField => ({
  id: uid('bf'),
  label,
  type,
  content: type === 'radar' ? stringifyRadar(DEFAULT_RADAR) : '',
  ...extra,
});

export type BlockEditorMode = 'fill' | 'schema';
export type BlockEditorVariant = 'character' | 'world';

const CHAR_TEMPLATES: Array<{ name: string; desc: string; make: () => { title: string; fields: BlockField[] } }> = [
  {
    name: '基礎資料',
    desc: '身高、體重、生日、職業',
    make: () => ({
      title: '基礎資料',
      fields: [
        newBlockField('number', '身高', { placeholder: 'cm' }),
        newBlockField('number', '體重', { placeholder: 'kg' }),
        newBlockField('date', '生日'),
        newBlockField('text', '職業'),
      ],
    }),
  },
  {
    name: '角色展示',
    desc: '一句話、關鍵字、喜好',
    make: () => ({
      title: '角色展示',
      fields: [
        newBlockField('text', '一句話介紹'),
        newBlockField('tags', '關鍵字'),
        newBlockField('tags', '喜歡'),
        newBlockField('tags', '討厭'),
      ],
    }),
  },
  {
    name: '能力設定',
    desc: '五維雷達、主技能、弱點',
    make: () => ({
      title: '能力設定',
      fields: [newBlockField('radar', '能力值'), newBlockField('text', '主技能'), newBlockField('textarea', '弱點', { style: 'box' })],
    }),
  },
  {
    name: '雙人／CP',
    desc: '對象、相性、關係、故事',
    make: () => ({
      title: '雙人／CP',
      fields: [
        newBlockField('charref', '對象'),
        newBlockField('rating', '相性', { max: 5 }),
        newBlockField('text', '關係'),
        newBlockField('textarea', '故事'),
      ],
    }),
  },
  {
    name: '委託須知',
    desc: '必畫重點、配色、參考連結',
    make: () => ({
      title: '委託須知',
      fields: [
        newBlockField('textarea', '必畫重點', { style: 'box' }),
        newBlockField('textarea', '不要畫成', { style: 'box' }),
        newBlockField('palette', '配色'),
        newBlockField('url', '參考連結'),
      ],
    }),
  },
  {
    name: '長文',
    desc: '背景、性格、故事',
    make: () => ({
      title: '背景',
      fields: [newBlockField('textarea', '', { style: 'normal' })],
    }),
  },
  { name: '相簿', desc: '一組圖片', make: () => ({ title: '相簿', fields: [newBlockField('image', '', { layout: 'grid' })] }) },
  { name: '時間線', desc: '重要事件', make: () => ({ title: '大事記', fields: [newBlockField('timeline', '大事記')] }) },
];

const WORLD_TEMPLATES: Array<{ name: string; desc: string; make: () => { title: string; fields: BlockField[] } }> = [
  {
    name: '年表',
    desc: '世界大事按時間排列',
    make: () => ({ title: '年表', fields: [newBlockField('timeline', '大事記')] }),
  },
  {
    name: '地理／場所',
    desc: '地點、特徵、圖片',
    make: () => ({
      title: '地理',
      fields: [
        newBlockField('text', '名稱'),
        newBlockField('tags', '特徵'),
        newBlockField('textarea', '說明', { style: 'box' }),
        newBlockField('image', '風景', { layout: 'grid' }),
      ],
    }),
  },
  {
    name: '勢力／陣營',
    desc: '名稱、立場、相關角色',
    make: () => ({
      title: '勢力',
      fields: [
        newBlockField('text', '名稱'),
        newBlockField('tags', '陣營'),
        newBlockField('textarea', '主張', { style: 'box' }),
        newBlockField('charref', '相關角色'),
      ],
    }),
  },
  {
    name: '規則／禁忌',
    desc: '世界怎麼運轉、什麼不能做',
    make: () => ({
      title: '規則',
      fields: [
        newBlockField('textarea', '運作規則', { style: 'box' }),
        newBlockField('checklist', '禁忌'),
        newBlockField('textarea', '例外', { style: 'indent' }),
      ],
    }),
  },
  {
    name: '用語辭典',
    desc: '專有名詞與解釋',
    make: () => ({
      title: '用語',
      fields: [newBlockField('text', '詞條'), newBlockField('textarea', '解釋'), newBlockField('tags', '分類')],
    }),
  },
  {
    name: '素材',
    desc: '圖、音、影、文件',
    make: () => ({
      title: '素材',
      fields: [
        newBlockField('image', '圖', { layout: 'grid' }),
        newBlockField('audio', '音'),
        newBlockField('video', '影'),
        newBlockField('pdf', '文件'),
      ],
    }),
  },
];

// 區塊內單一欄位：一行名稱＋型別，內容直接在下面；其餘收進 ⋯
function BlockFieldRow({
  field: f,
  onPatch,
  onRemove,
  onMove,
  isFirst,
  isLast,
  roster,
}: {
  field: BlockField;
  onPatch: (p: Partial<BlockField>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  isFirst: boolean;
  isLast: boolean;
  roster: RosterLite[];
}) {
  const t = f.type;
  const isTexty = t === 'text' || t === 'textarea';
  const needsOptions = t === 'select' || t === 'multiselect';
  const menu = [
    {
      label: (f.visibility ?? 'public') === 'private' ? '改為公開' : '改為私人',
      onClick: () => onPatch({ visibility: (f.visibility ?? 'public') === 'private' ? 'public' : 'private' }),
    },
    { label: '上移', onClick: () => onMove(-1), disabled: isFirst },
    { label: '下移', onClick: () => onMove(1), disabled: isLast },
    ...(isTexty
      ? FIELD_STYLES.map(([v, label]) => ({
          label: `樣式：${label}`,
          onClick: () => onPatch({ style: v }),
        }))
      : []),
    ...(t === 'rating'
      ? [3, 5, 10].map((m) => ({
          label: `滿分 ${m}`,
          onClick: () => onPatch({ max: m }),
        }))
      : []),
    { label: '刪除欄位', onClick: onRemove, danger: true },
  ];
  return (
    <div className="kg-field space-y-2">
      <div className="flex items-center gap-2">
        <input
          className="kg-input !h-10 !w-auto flex-1 min-w-0 text-sm font-bold"
          value={f.label}
          onChange={(e) => onPatch({ label: e.target.value })}
          placeholder="欄位名稱"
          maxLength={12}
        />
        <select
          className="kg-select !h-10 !w-auto max-w-[38%] text-sm !py-0"
          value={t}
          aria-label="欄位型別"
          onChange={(e) => {
            const nt = e.target.value as BlockFieldType;
            onPatch({
              type: nt,
              ...(nt === 'radar' && !f.content.trim() ? { content: stringifyRadar(DEFAULT_RADAR) } : {}),
              ...(nt !== 'image' ? { images: undefined, layout: undefined } : {}),
              ...(nt !== 'pdf' ? { fileName: undefined } : {}),
            });
          }}
        >
          {BLOCKFIELD_TYPE_GROUPS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.items.map((it) => (
                <option key={it.value} value={it.value}>
                  {it.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {(f.visibility ?? 'public') === 'private' && (
          <span className="font-mono2 text-[10px] text-[#a8455e] shrink-0">🔒</span>
        )}
        <RowMenu items={menu} />
      </div>
      {needsOptions && (
        <input
          className="kg-input !h-10 font-mono2 text-xs"
          value={(f.options ?? []).join(',')}
          onChange={(e) => onPatch({ options: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })}
          placeholder="選項，逗號分隔：人類,精靈"
        />
      )}
      {isTexty ? (
        t === 'text' ? (
          <input className="kg-input" value={f.content} onChange={(e) => onPatch({ content: e.target.value })} placeholder={f.placeholder || '內容…'} maxLength={200} />
        ) : (
          <textarea className="kg-textarea" rows={4} value={f.content} onChange={(e) => onPatch({ content: e.target.value })} placeholder={f.placeholder || '內容…'} maxLength={4000} />
        )
      ) : t === 'image' || t === 'pdf' ? (
        <BlockFileInput block={f} onPatch={onPatch} />
      ) : (
        <FieldInput
          def={{ key: f.id, label: f.label || '欄位', type: t, options: f.options, placeholder: f.placeholder, max: f.max, style: f.style }}
          value={f.content}
          onChange={(v) => onPatch({ content: v })}
          roster={roster}
        />
      )}
    </div>
  );
}

// 填寫模式：只改內容，不露型別／刪除／排序
function FillFieldRow({
  field: f,
  onPatch,
  roster,
}: {
  field: BlockField;
  onPatch: (p: Partial<BlockField>) => void;
  roster: RosterLite[];
}) {
  const t = f.type;
  const [sheet, setSheet] = useState(false);
  const useSheet = t === 'textarea' || t === 'timeline' || t === 'calendar' || t === 'image';
  const editor =
    t === 'image' || t === 'pdf' ? (
      <BlockFileInput block={f} onPatch={onPatch} />
    ) : t === 'radar' ? (
      <RadarInput value={f.content} onChange={(v) => onPatch({ content: v })} compact />
    ) : t === 'text' ? (
      <input
        className="kg-input"
        value={f.content}
        onChange={(e) => onPatch({ content: e.target.value })}
        placeholder={f.placeholder || '內容…'}
        maxLength={200}
      />
    ) : t === 'textarea' ? (
      <textarea
        className="kg-textarea"
        rows={12}
        autoFocus={sheet}
        value={f.content}
        onChange={(e) => onPatch({ content: e.target.value })}
        placeholder={f.placeholder || '內容…'}
        maxLength={4000}
      />
    ) : (
      <FieldInput
        def={{ key: f.id, label: f.label || '欄位', type: t, options: f.options, placeholder: f.placeholder, max: f.max, style: f.style }}
        value={f.content}
        onChange={(v) => onPatch({ content: v })}
        roster={roster}
      />
    );

  let preview: ReactNode = <span className="kg-fill-preview-empty">點擊編輯</span>;
  if (t === 'textarea') {
    preview = f.content.trim() ? (
      <span className="line-clamp-3 whitespace-pre-wrap">{f.content.trim()}</span>
    ) : (
      <span className="kg-fill-preview-empty">點擊寫長文</span>
    );
  } else if (t === 'timeline' || t === 'calendar') {
    const n = timelineVisible(parseTimeline(f.content)).length;
    preview = n ? <span>{n} 則</span> : <span className="kg-fill-preview-empty">點擊編輯</span>;
  } else if (t === 'image') {
    const n = f.images?.length ?? 0;
    preview = n ? (
      <span className="flex gap-1.5 overflow-hidden">
        {(f.images ?? []).slice(0, 4).map((src) => (
          <img key={src.slice(0, 48)} src={src} alt="" className="w-12 h-12 rounded-lg object-cover border border-[#e8dfd4]" />
        ))}
        {n > 4 && <span className="font-mono2 text-[11px] text-[#6f6156] self-center">+{n - 4}</span>}
      </span>
    ) : (
      <span className="kg-fill-preview-empty">點擊加入圖片</span>
    );
  }

  return (
    <div className="space-y-1.5">
      {(f.label || (f.visibility ?? 'public') === 'private') && (
        <div className="flex items-center gap-2">
          {f.label && <div className="kg-seclabel">（{f.label}）</div>}
          {(f.visibility ?? 'public') === 'private' && (
            <span className="font-mono2 text-[10px] text-[#a8455e]">🔒 私人</span>
          )}
        </div>
      )}
      {useSheet ? (
        <>
          <button type="button" className="kg-fill-preview" onClick={() => setSheet(true)}>
            {preview}
          </button>
          {sheet && (
            <FillSheet title={f.label || '編輯'} onDone={() => setSheet(false)}>
              {editor}
            </FillSheet>
          )}
        </>
      ) : (
        editor
      )}
    </div>
  );
}

// 單一區塊的編輯卡（填寫＝手風琴；組版＝型別／排序／預覽）
function BlockEditCard({
  block: b,
  index: i,
  count,
  onPatch,
  onMove,
  onRemove,
  roster,
  slug,
  mode,
  open,
  onToggle,
}: {
  block: WorldBlock;
  index: number;
  count: number;
  onPatch: (p: Partial<WorldBlock>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  roster: RosterLite[];
  slug?: string;
  mode: BlockEditorMode;
  open: boolean;
  onToggle: () => void;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const patchField = (fid: string, p: Partial<BlockField>) =>
    onPatch({ fields: b.fields.map((f) => (f.id === fid ? { ...f, ...p } : f)) });
  const moveField = (fi: number, dir: -1 | 1) => {
    const j = fi + dir;
    if (j < 0 || j >= b.fields.length) return;
    const next = [...b.fields];
    [next[fi], next[j]] = [next[j], next[fi]];
    onPatch({ fields: next });
  };

  if (mode === 'fill') {
    const filledN = b.fields.filter((f) => fieldHasContent(f.type, f.content, f.images)).length;
    return (
      <div className="kg-card-flat overflow-hidden">
        <button type="button" className="kg-acc-head" aria-expanded={open} onClick={onToggle}>
          <span className={`w-2 h-2 rounded-full shrink-0 ${filledN ? 'bg-[#9e4b2c]' : 'bg-[#e8dfd4]'}`} />
          <span className="font-bold flex-1 truncate">{b.title || '未命名區塊'}</span>
          <span className="font-mono2 text-[10px] text-[#6f6156] shrink-0">
            {filledN}/{b.fields.length} 已填
          </span>
          <span className="kg-chevron text-[#6f6156]" aria-hidden="true">
            {open ? '▴' : '▾'}
          </span>
        </button>
        {open && (
          <div className="p-4 space-y-4 border-t-2 border-[#e8dfd4]">
            {b.fields.length === 0 ? (
              <p className="text-sm text-[#6f6156]">這塊還沒有欄位。到「組版」去加。</p>
            ) : (
              b.fields.map((f) => <FillFieldRow key={f.id} field={f} onPatch={(p) => patchField(f.id, p)} roster={roster} />)
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="kg-card-flat overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e8dfd4] bg-[#f6efe4]/50">
        <span className="w-2 h-2 rounded-full bg-[#9e4b2c] shrink-0" />
        <input
          className="kg-input !h-10 !w-auto flex-1 min-w-0 font-bold"
          value={b.title}
          onChange={(e) => onPatch({ title: e.target.value })}
          placeholder="區塊標題"
          maxLength={20}
        />
        <span className="font-mono2 text-[10px] text-[#6f6156] shrink-0">{b.fields.length} 欄</span>
        <RowMenu
          items={[
            { label: showPreview ? '收起預覽' : '預覽成品', onClick: () => setShowPreview(!showPreview) },
            { label: '上移', onClick: () => onMove(-1), disabled: i === 0 },
            { label: '下移', onClick: () => onMove(1), disabled: i === count - 1 },
            { label: '刪除區塊', onClick: onRemove, danger: true },
          ]}
        />
      </div>
      <div className="px-4">
        {b.fields.map((f, fi) => (
          <BlockFieldRow
            key={f.id}
            field={f}
            onPatch={(p) => patchField(f.id, p)}
            onRemove={() => onPatch({ fields: b.fields.filter((x) => x.id !== f.id) })}
            onMove={(dir) => moveField(fi, dir)}
            isFirst={fi === 0}
            isLast={fi === b.fields.length - 1}
            roster={roster}
          />
        ))}
        <div className="py-3">
          <button
            type="button"
            className="kg-pill kg-pill-ghost kg-pill-sm border-dashed min-h-10"
            onClick={() => onPatch({ fields: [...b.fields, newBlockField('text')] })}
          >
            ＋ 欄位
          </button>
        </div>
      </div>
      {showPreview && (
        <div className="border-t border-dashed border-[#e8dfd4] px-4 py-3 bg-[#fbf8f3]">
          <div className="font-mono2 text-[10px] text-[#6f6156] mb-2">成品預覽</div>
          <BlockView block={b} slug={slug} roster={roster} bare />
        </div>
      )}
    </div>
  );
}

export function BlocksEditor({
  value,
  onChange,
  roster = [],
  slug,
  mode = 'schema',
  variant = 'character',
  onRequestSchema,
  onAdded,
  seedOpenId,
}: {
  value: WorldBlock[];
  onChange: (v: WorldBlock[]) => void;
  roster?: RosterLite[];
  slug?: string;
  mode?: BlockEditorMode;
  variant?: BlockEditorVariant;
  onRequestSchema?: () => void;
  onAdded?: (id: string) => void;
  seedOpenId?: string | null;
}) {
  const templates = variant === 'world' ? WORLD_TEMPLATES : CHAR_TEMPLATES;
  const [openId, setOpenId] = useState<string | null>(seedOpenId ?? value[0]?.id ?? null);
  useEffect(() => {
    if (seedOpenId && value.some((b) => b.id === seedOpenId)) {
      setOpenId(seedOpenId);
    }
  }, [seedOpenId, value]);
  useEffect(() => {
    if (mode !== 'fill') return;
    if (openId && value.some((b) => b.id === openId)) return;
    setOpenId(value[value.length - 1]?.id ?? null);
  }, [mode, value, openId]);

  const patch = (id: string, p: Partial<WorldBlock>) => onChange(value.map((b) => (b.id === id ? { ...b, ...p } : b)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const addFrom = (make?: () => { title: string; fields: BlockField[] }) => {
    const block = { id: uid('wb'), ...(make ? make() : { title: '', fields: [] as BlockField[] }) };
    onChange([...value, block]);
    setOpenId(block.id);
    onAdded?.(block.id);
  };

  return (
    <div className="space-y-4">
      {value.length === 0 && mode === 'fill' && (
        <div className="kg-card-flat p-5 text-center space-y-3">
          <p className="text-sm text-[#6f6156]">還沒有區塊。</p>
          {onRequestSchema && (
            <button type="button" className="kg-pill kg-pill-red min-h-11" onClick={onRequestSchema}>
              去組版，加一塊
            </button>
          )}
        </div>
      )}
      {value.map((b, i) => (
        <BlockEditCard
          key={b.id}
          block={b}
          index={i}
          count={value.length}
          onPatch={(p) => patch(b.id, p)}
          onMove={(dir) => move(i, dir)}
          onRemove={() => onChange(value.filter((x) => x.id !== b.id))}
          roster={roster}
          slug={slug}
          mode={mode}
          open={openId === b.id}
          onToggle={() => setOpenId(openId === b.id ? null : b.id)}
        />
      ))}
      {mode === 'schema' && (
        <>
          <button
            type="button"
            className="kg-pill kg-pill-ghost w-full justify-center border-dashed min-h-11"
            onClick={() => addFrom()}
          >
            ＋ 空白區塊
          </button>
          <div>
            <div className="font-mono2 text-[11px] text-[#6f6156] mb-1.5">或從模板開始（套用後都能再增減欄位）</div>
            <div className="flex flex-wrap gap-1.5">
              {templates.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  title={t.desc}
                  className="kg-pill kg-pill-ghost kg-pill-sm border-dashed min-h-10"
                  onClick={() => addFrom(t.make)}
                >
                  ＋ {t.name}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- 區塊顯示（企劃頁／角色頁／預覽共用） ----------
export function BlockView({
  block,
  slug,
  roster = [],
  canSeePrivate = true,
  onPreview,
  bare = false,
}: {
  block: WorldBlock;
  slug?: string;
  roster?: RosterLite[];
  canSeePrivate?: boolean;
  onPreview?: (t: PreviewTarget, i: number) => void;
  bare?: boolean;
}) {
  const fields = block.fields.filter(
    (f) => (canSeePrivate || (f.visibility ?? 'public') === 'public') && fieldHasContent(f.type, f.content, f.images),
  );
  if (fields.length === 0) {
    return bare ? <p className="text-sm text-[#7a6f63]">（這個區塊還沒有可顯示的內容）</p> : null;
  }
  const body = (
    <div className="divide-y divide-dashed divide-[#e8dfd4]">
      {fields.map((f) => (
        <div key={f.id} className="py-3 first:pt-0 last:pb-0 space-y-1.5">
          {f.label && (
            <div className="kg-seclabel">
              （{f.label}）
              {(f.visibility ?? 'public') === 'private' && (
                <span className="ml-1.5 font-mono2 text-[10px] text-[#a8455e]">🔒 私人</span>
              )}
            </div>
          )}
          {f.type === 'image' ? (
            <GalleryView title={f.label || block.title} content={f.content} images={f.images} layout={f.layout} onPreview={(t, i) => onPreview?.(t, i)} />
          ) : f.type === 'pdf' ? (
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-[#e3d5c5] bg-[#7fc0dc11] px-4 py-3 text-left hover:border-[#24697f] transition-colors"
              onClick={() => onPreview?.({ title: f.label || block.title, type: 'pdf', content: f.content, fileName: f.fileName }, 0)}
            >
              <span className="kg-tag shrink-0">PDF</span>
              <span className="font-mono2 text-xs text-[#6f6156] truncate">{f.fileName || '附件文件'}</span>
              <span className="ml-auto font-mono2 text-[11px] text-[#24697f] shrink-0">點擊預覽 ↗</span>
            </button>
          ) : f.type === 'text' || f.type === 'textarea' ? (
            <StyledText text={f.content} style={f.style} />
          ) : (
            <FieldView
              def={{ key: f.id, label: f.label, type: f.type, max: f.max, style: f.style, options: f.options }}
              value={f.content}
              slug={slug}
              roster={roster}
            />
          )}
        </div>
      ))}
    </div>
  );
  if (bare) return body;
  return (
    <div className="kg-card-flat overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 pt-4 pb-3 border-b border-dashed border-[#e8dfd4]">
        <span className="w-2 h-2 rounded-full bg-[#9e4b2c] shrink-0" />
        <h3 className="font-huninn text-lg">{block.title}</h3>
      </div>
      <div className="p-5">{body}</div>
    </div>
  );
}

function BlockFileInput({ block, onPatch }: { block: BlockField; onPatch: (p: Partial<BlockField>) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const isPdf = block.type === 'pdf';

  if (!isPdf) {
    // 圖片＝一組相簿：多圖上傳、輪播/縮圖、逐張刪減
    // content 相容舊資料；但若內容不是圖片（例如從純文字轉來）就忽略
    const images = block.images ?? (/^(data:image|https?:)/.test(block.content) && block.content ? [block.content] : []);
    const [urlDraft, setUrlDraft] = useState('');
    const setImages = (imgs: string[]) => onPatch({ images: imgs, content: imgs[0] ?? '' });
    const addUrl = (url: string) => {
      const u = url.trim();
      if (u) setImages([...images, u]);
      setUrlDraft('');
    };
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? '處理中…' : '＋ 上傳圖片（可複選）'}
          </button>
          <span className="font-mono2 text-[11px] text-[#6f6156]">{images.length} 張</span>
          {images.length > 0 && (
            <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm" onClick={() => setPreview(true)}>
              預覽
            </button>
          )}
          <span className="ml-auto flex items-center gap-1">
            <span className="font-mono2 text-[11px] text-[#6f6156] mr-1">呈現</span>
            {(
              [
                ['carousel', '輪播'],
                ['grid', '縮圖'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={`kg-pill kg-pill-sm ${((block.layout ?? 'grid') === v) ? 'kg-pill-ink' : 'kg-pill-ghost'}`}
                onClick={() => onPatch({ layout: v })}
              >
                {label}
              </button>
            ))}
          </span>
        </div>
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((src, i) => (
              <div key={i} className="relative group">
                <img src={src} alt={`${block.label || '圖片'} ${i + 1}`} className="w-20 h-20 rounded-lg border-2 border-[#e8dfd4] object-cover" />
                <button
                  type="button"
                  aria-label="刪除這張"
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#a8455e] text-white text-[11px] leading-none flex items-center justify-center opacity-90 hover:opacity-100"
                  onClick={() => setImages(images.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            className="kg-input font-mono2 text-xs flex-1"
            placeholder="或貼上圖片網址 https://…"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addUrl(urlDraft);
              }
            }}
          />
          <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm shrink-0" disabled={!urlDraft.trim()} onClick={() => addUrl(urlDraft)}>
            加入
          </button>
        </div>
        {err && <p className="text-xs font-bold text-[#a8455e]">{err}</p>}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length === 0) return;
            setBusy(true);
            setErr(null);
            try {
              const added: string[] = [];
              for (const f of files) added.push(await readImageFile(f));
              setImages([...images, ...added]);
            } catch (ex) {
              setErr(ex instanceof Error ? ex.message : '上傳失敗');
            } finally {
              setBusy(false);
            }
          }}
        />
        {preview && <PreviewModal block={{ ...block, images, title: block.label || '圖片' }} onClose={() => setPreview(false)} />}
      </div>
    );
  }

  const hasPdf = /^(data:application\/pdf|https?:)/.test(block.content);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? '處理中…' : '上傳 PDF'}
        </button>
        {hasPdf && (
          <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm" onClick={() => setPreview(true)}>
            預覽
          </button>
        )}
        {hasPdf && (
          <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm" onClick={() => onPatch({ content: '', fileName: undefined })}>
            移除檔案
          </button>
        )}
        {block.fileName && <span className="font-mono2 text-[11px] text-[#6f6156]">{block.fileName}</span>}
      </div>
      {err && <p className="text-xs font-bold text-[#a8455e]">{err}</p>}
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          setErr(null);
          try {
            onPatch({ content: await readPdfFile(f), fileName: f.name });
          } catch (ex) {
            setErr(ex instanceof Error ? ex.message : '上傳失敗');
          } finally {
            setBusy(false);
          }
        }}
      />
      {preview && <PreviewModal block={{ ...block, title: block.label || 'PDF 文件' }} onClose={() => setPreview(false)} />}
    </div>
  );
}

// ---------- QA 編輯器 ----------
export function QaEditor({
  value,
  onChange,
  groups = [],
}: {
  value: QaItem[];
  onChange: (v: QaItem[]) => void;
  groups?: TagGroup[];
}) {
  const patch = (id: string, p: Partial<QaItem>) => onChange(value.map((x) => (x.id === id ? { ...x, ...p } : x)));
  return (
    <div className="space-y-4">
      {value.map((item) => (
        <div key={item.id} className="kg-card-flat p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="font-huninn text-[#9e4b2c] shrink-0">Q</span>
            <ImeInput
              className="kg-input !w-auto flex-1"
              value={item.q}
              onChange={(v) => patch(item.id, { q: v })}
              placeholder="問題"
              maxLength={60}
            />
            <button
              type="button"
              className="kg-pill kg-pill-ghost kg-pill-sm text-[#a8455e] shrink-0"
              onClick={() => onChange(value.filter((x) => x.id !== item.id))}
            >
              刪除
            </button>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-huninn text-[#24697f] shrink-0 mt-2">A</span>
            <ImeTextarea
              className="kg-textarea flex-1"
              rows={2}
              value={item.a}
              onChange={(v) => patch(item.id, { a: v })}
              placeholder="回答"
              maxLength={500}
            />
          </div>
          {groups.length > 0 && (
            <TagPicker groups={groups} value={item.tags ?? []} onChange={(tags) => patch(item.id, { tags })} />
          )}
        </div>
      ))}
      <button
        type="button"
        className="kg-pill kg-pill-ghost w-full justify-center border-dashed"
        onClick={() => onChange([...value, { id: uid('qa'), q: '', a: '', tags: [] }])}
      >
        ＋ 新增問答
      </button>
    </div>
  );
}

export function TagPicker({
  groups,
  value,
  onChange,
}: {
  groups: TagGroup[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  if (!groups.length) return null;
  const toggle = (tag: string) => onChange(value.includes(tag) ? value.filter((t) => t !== tag) : [...value, tag]);
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.id}>
          <div className="kg-seclabel mb-1.5">
            （{g.name}）{g.required ? <span className="req"> *</span> : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {g.tags.map((t) => (
              <button
                key={t}
                type="button"
                className={`kg-pill kg-pill-sm ${value.includes(t) ? 'kg-pill-ink' : 'kg-pill-ghost border !border-[#e8dfd4]'}`}
                onClick={() => toggle(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function FilterChips({
  groups,
  tags,
  value,
  onChange,
}: {
  groups?: TagGroup[];
  tags?: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const grouped = (groups ?? []).filter((g) => g.tags.length);
  const groupedSet = new Set(grouped.flatMap((g) => g.tags));
  const rest = (tags ?? []).filter((t) => !groupedSet.has(t));
  if (!grouped.length && !rest.length) return null;
  const chip = (t: string) => (
    <button
      key={t}
      type="button"
      className={`kg-pill kg-pill-sm ${value === t ? 'kg-pill-ink' : 'kg-pill-ghost border !border-[#e8dfd4]'}`}
      onClick={() => onChange(value === t ? '' : t)}
    >
      {t}
    </button>
  );
  return (
    <div className="space-y-2 mb-4">
      <div className="flex flex-wrap gap-1.5 items-center">
        <button
          type="button"
          className={`kg-pill kg-pill-sm ${!value ? 'kg-pill-ink' : 'kg-pill-ghost border !border-[#e8dfd4]'}`}
          onClick={() => onChange('')}
        >
          全部
        </button>
        {rest.map(chip)}
      </div>
      {grouped.map((g) => (
        <div key={g.id} className="flex flex-wrap gap-1.5 items-center">
          {g.name ? <span className="font-mono2 text-[11px] text-[#6f6156] shrink-0 w-10">{g.name}</span> : null}
          {g.tags.map(chip)}
        </div>
      ))}
    </div>
  );
}

export function TagGroupEditor({ value, onChange }: { value: TagGroup[]; onChange: (v: TagGroup[]) => void }) {
  const patch = (id: string, p: Partial<TagGroup>) => onChange(value.map((g) => (g.id === id ? { ...g, ...p } : g)));
  return (
    <div className="space-y-3">
      {value.map((g) => (
        <div key={g.id} className="kg-field space-y-2">
          <div className="flex items-center gap-2">
            <ImeInput
              className="kg-input !h-10 !w-auto flex-1 min-w-0 font-bold"
              value={g.name}
              onChange={(v) => patch(g.id, { name: v })}
              placeholder="分類名（陣營、種族…）"
              maxLength={12}
            />
            <label className="flex items-center gap-1.5 text-sm font-bold cursor-pointer select-none shrink-0">
              <input
                type="checkbox"
                checked={!!g.required}
                onChange={(e) => patch(g.id, { required: e.target.checked })}
                className="w-4 h-4 accent-[#9e4b2c]"
              />
              角色必填
            </label>
            <button
              type="button"
              className="kg-pill kg-pill-ghost kg-pill-sm text-[#a8455e]"
              onClick={() => onChange(value.filter((x) => x.id !== g.id))}
            >
              刪除
            </button>
          </div>
          <TagsInput value={g.tags.join(',')} onChange={(v) => patch(g.id, { tags: v.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })} placeholder="標籤，Enter 新增…" />
        </div>
      ))}
      <button
        type="button"
        className="kg-pill kg-pill-ghost kg-pill-sm border-dashed"
        onClick={() => onChange([...value, { id: uid('tg'), name: '', tags: [], required: false }])}
      >
        ＋ 一組分類
      </button>
      <p className="font-mono2 text-[11px] text-[#6f6156]">角色加入時勾選；問答也可掛同一批標籤。名單與問答頁能用標籤篩選。</p>
    </div>
  );
}

// ---------- 欄位類型（名帖式，區塊與欄位共用） ----------
export interface FieldTypeMeta {
  value: FieldType;
  label: string;
  hint: string;
}
export const FIELD_TYPE_GROUPS: Array<{ group: string; items: FieldTypeMeta[] }> = [
  {
    group: '文字',
    items: [
      { value: 'text', label: '短文字', hint: '一句話、一個數值' },
      { value: 'textarea', label: '長文字', hint: '一整段描述' },
    ],
  },
  {
    group: '選項・標籤',
    items: [
      { value: 'tags', label: '標籤', hint: '一組關鍵詞' },
      { value: 'select', label: '單選', hint: '幾個裡選一個' },
      { value: 'multiselect', label: '多選', hint: '幾個裡選多個' },
      { value: 'checklist', label: '核取清單', hint: '可勾選的清單' },
    ],
  },
  {
    group: '數值・時間',
    items: [
      { value: 'number', label: '數字', hint: '純數字' },
      { value: 'date', label: '日期', hint: '一個日期' },
      { value: 'rating', label: '評分', hint: '星級評比' },
      { value: 'radar', label: '五維雷達', hint: '能力值雷達圖' },
      { value: 'timeline', label: '時間線', hint: '事件時間線' },
      { value: 'calendar', label: '行事曆', hint: '月曆標記＋日程表' },
    ],
  },
  {
    group: '色彩',
    items: [
      { value: 'color', label: '顏色', hint: '單一顏色' },
      { value: 'palette', label: '色票', hint: '一組配色' },
    ],
  },
  {
    group: '媒體',
    items: [
      { value: 'image', label: '圖片', hint: '一張圖' },
      { value: 'audio', label: '音樂', hint: '一段音樂' },
      { value: 'video', label: '影片', hint: '一支影片' },
    ],
  },
  {
    group: '連結・關係',
    items: [
      { value: 'url', label: '連結', hint: '外部連結' },
      { value: 'charref', label: '關聯角色', hint: '連到其他角色' },
    ],
  },
];
export const FIELD_TYPES: FieldTypeMeta[] = FIELD_TYPE_GROUPS.flatMap((g) => g.items);
export const fieldTypeLabel = (t: FieldType): string => FIELD_TYPES.find((x) => x.value === t)?.label ?? t;
// 區塊型別標籤（text 在區塊裡叫「純文字」，另有區塊專屬的 pdf）
export const blockTypeLabel = (t: string): string => (t === 'pdf' ? 'PDF' : t === 'text' ? '純文字' : fieldTypeLabel(t as FieldType));

// 常見欄位快速加入（名帖式）
export const COMMON_FIELDS: Array<{ label: string; def: Omit<FieldDef, 'key' | 'label'> }> = [
  { label: '身高', def: { type: 'number', placeholder: 'cm' } },
  { label: '體重', def: { type: 'number', placeholder: 'kg' } },
  { label: '生日', def: { type: 'date' } },
  { label: '髮色', def: { type: 'color' } },
  { label: '瞳色', def: { type: 'color' } },
  { label: '職業', def: { type: 'text' } },
  { label: '喜好', def: { type: 'tags' } },
  { label: '專長', def: { type: 'tags' } },
];

// 極簡角色資料（關聯角色用）
export interface RosterLite {
  id: string;
  name: string;
  avatar_url: string | null;
}

const fieldType = (f: FieldDef) => f.type ?? 'text';

// 標籤輸入：Enter 加入、點 × 移除（值以逗號串接儲存）
function TagsInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const tags = value ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const commit = (raw?: string) => {
    const t = (raw ?? draft).trim();
    if (t && !tags.includes(t)) onChange([...tags, t].join(','));
    setDraft('');
  };
  return (
    <div className="kg-input !h-auto flex flex-wrap items-center gap-1.5 py-2 cursor-text" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}>
      {tags.map((t) => (
        <span key={t} className="kg-tag">
          {t}
          <button type="button" className="ml-1 opacity-70 hover:opacity-100" onClick={() => onChange(tags.filter((x) => x !== t).join(','))}>
            ×
          </button>
        </span>
      ))}
      <ImeInput
        className="flex-1 min-w-[90px] bg-transparent outline-none text-sm"
        value={draft}
        onChange={setDraft}
        onKeyDown={(e) => {
          if (isComposingEvent(e) || e.key === 'Process') return;
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit(e.currentTarget.value);
          } else if (e.key === 'Backspace' && !draft && tags.length) {
            onChange(tags.slice(0, -1).join(','));
          }
        }}
        onBlur={(e) => commit(e.currentTarget.value)}
        placeholder={tags.length === 0 ? placeholder ?? '輸入後 Enter…' : ''}
      />
    </div>
  );
}

// ---------- 各型別的輸入／顯示元件 ----------

// 核取清單
export function ChecklistInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const items = parseChecklist(value);
  const set = (next: ChecklistItem[]) => onChange(stringifyChecklist(next));
  return (
    <div className="space-y-1.5 pt-1">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={it.done}
            onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))}
            className="w-4 h-4 accent-[#9e4b2c] shrink-0"
          />
          <input
            className="kg-input !h-9 flex-1 text-sm"
            value={it.text}
            onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
            placeholder="事項…"
            maxLength={60}
          />
          <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm text-[#a8455e] shrink-0" onClick={() => set(items.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm border-dashed" onClick={() => set([...items, { text: '', done: false }])}>
        ＋ 新增項目
      </button>
    </div>
  );
}

export function ChecklistView({ value }: { value: string }) {
  const items = checklistVisible(parseChecklist(value));
  if (!items.length) return null;
  return (
    <ul className="space-y-1">
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-2 text-sm">
          <span className={`font-mono2 ${it.done ? 'text-[#9e4b2c]' : 'text-[#6f6156]'}`}>{it.done ? '☑' : '☐'}</span>
          <span className={it.done ? 'line-through opacity-60' : ''}>{it.text}</span>
        </li>
      ))}
    </ul>
  );
}

// 五維雷達：SVG 圖（編輯與顯示共用）
export function RadarChart({ dims: rawDims, size = 190 }: { dims: RadarDim[]; size?: number }) {
  const dims = radarVisible(rawDims);
  const n = dims.length;
  if (n < 3) return <p className="font-mono2 text-[11px] text-[#6f6156]">至少需要 3 個維度才能畫雷達圖</p>;
  const c = size / 2;
  const r = size / 2 - 30;
  const pt = (i: number, ratio: number): [number, number] => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [c + Math.cos(a) * r * ratio, c + Math.sin(a) * r * ratio];
  };
  const ring = (ratio: number) => dims.map((_, i) => pt(i, ratio).join(',')).join(' ');
  const vals = dims.map((d, i) => pt(i, d.value / 5).join(',')).join(' ');
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <polygon key={k} points={ring(k)} fill="none" stroke="#e8dfd4" strokeWidth="1" />
      ))}
      {dims.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="#e8dfd4" strokeWidth="1" />;
      })}
      <polygon points={vals} fill="rgba(36,105,127,0.22)" stroke="#24697f" strokeWidth="2" />
      {dims.map((d, i) => {
        const [x, y] = pt(i, d.value / 5);
        return <circle key={i} cx={x} cy={y} r="3" fill="#24697f" />;
      })}
      {dims.map((d, i) => {
        const [x, y] = pt(i, 1.22);
        return (
          <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="#6f6156" fontFamily="'JetBrains Mono',monospace">
            {d.label} {d.value}
          </text>
        );
      })}
    </svg>
  );
}

export function RadarInput({ value, onChange, compact = false }: { value: string; onChange: (v: string) => void; compact?: boolean }) {
  const dims = parseRadar(value);
  const set = (next: RadarDim[]) => onChange(stringifyRadar(next));
  const bump = (i: number, delta: number) =>
    set(dims.map((x, j) => (j === i ? { ...x, value: Math.max(0, Math.min(5, x.value + delta)) } : x)));
  return (
    <div className={`flex flex-wrap items-start gap-4 pt-1 ${compact ? '' : ''}`}>
      {!compact && <RadarChart dims={dims} />}
      <div className="flex-1 min-w-[220px] space-y-1.5">
        {dims.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            {compact ? (
              <span className="text-sm font-bold w-16 shrink-0 truncate">{d.label || '維度'}</span>
            ) : (
              <input
                className="kg-input !h-9 !w-24 text-sm"
                value={d.label}
                onChange={(e) => set(dims.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                placeholder="維度"
                maxLength={6}
              />
            )}
            {compact ? (
              <div className="flex items-center gap-1 ml-auto">
                <button type="button" className="kg-pill kg-pill-ghost !px-3 min-h-10 min-w-10 justify-center" aria-label="減少" onClick={() => bump(i, -1)}>
                  −
                </button>
                <span className="font-mono2 text-sm text-[#24697f] w-6 text-center">{d.value}</span>
                <button type="button" className="kg-pill kg-pill-ghost !px-3 min-h-10 min-w-10 justify-center" aria-label="增加" onClick={() => bump(i, 1)}>
                  ＋
                </button>
              </div>
            ) : (
              <>
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={1}
                  value={d.value}
                  onChange={(e) => set(dims.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)))}
                  className="flex-1 accent-[#24697f]"
                />
                <span className="font-mono2 text-sm text-[#24697f] w-4 text-center">{d.value}</span>
                <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm text-[#a8455e] shrink-0" onClick={() => set(dims.filter((_, j) => j !== i))}>
                  ×
                </button>
              </>
            )}
          </div>
        ))}
        {!compact && dims.length < 8 && (
          <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm border-dashed" onClick={() => set([...dims, { label: '', value: 3 }])}>
            ＋ 新增維度
          </button>
        )}
      </div>
    </div>
  );
}

// 時間線
export function TimelineInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const events = parseTimeline(value);
  const set = (next: TimelineEvent[]) => onChange(stringifyTimeline(next));
  const patch = (i: number, p: Partial<TimelineEvent>) => set(events.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="space-y-2 pt-1">
      {events.map((ev, i) => (
        <div key={i} className="kg-card-flat p-2.5 flex flex-wrap items-center gap-2">
          <input type="date" className="kg-input !h-9 !w-auto text-sm font-mono2" value={ev.date} onChange={(e) => patch(i, { date: e.target.value })} />
          <input className="kg-input !h-9 flex-1 min-w-[120px] text-sm font-bold" value={ev.title} onChange={(e) => patch(i, { title: e.target.value })} placeholder="事件標題" maxLength={30} />
          <input className="kg-input !h-9 flex-[2] min-w-[140px] text-sm" value={ev.note ?? ''} onChange={(e) => patch(i, { note: e.target.value })} placeholder="補述（選填）" maxLength={80} />
          <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm text-[#a8455e] shrink-0" onClick={() => set(events.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm border-dashed" onClick={() => set([...events, { date: '', title: '', note: '' }])}>
        ＋ 新增事件
      </button>
    </div>
  );
}

export function TimelineView({ value }: { value: string }) {
  const events = [...timelineVisible(parseTimeline(value))].sort((a, b) => a.date.localeCompare(b.date));
  if (!events.length) return null;
  return (
    <ol className="relative border-l-2 border-[#e8dfd4] ml-2 space-y-3 py-1">
      {events.map((ev, i) => (
        <li key={i} className="pl-4 relative">
          <span className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-[#9e4b2c]" />
          <div className="font-mono2 text-[11px] text-[#6f6156]">{ev.date || '未定日期'}</div>
          <div className="font-bold text-sm">{ev.title}</div>
          {ev.note && <div className="text-sm text-[#6f6156] whitespace-pre-wrap">{ev.note}</div>}
        </li>
      ))}
    </ol>
  );
}

// 行事曆：月曆標記重要日期，下面接日程表
export function CalendarView({ value }: { value: string }) {
  const events = timelineVisible(parseTimeline(value));
  const withDate = events.filter((e) => e.date);
  const noDate = events.filter((e) => !e.date);
  // 預設停在最靠近今天的月份（無日期則用今天）
  const initMonth = () => {
    const today = new Date();
    const tstr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const sorted = [...withDate].sort((a, b) => a.date.localeCompare(b.date));
    const next = sorted.find((e) => e.date >= tstr) ?? sorted[sorted.length - 1];
    if (next) {
      const [y, m] = next.date.split('-').map(Number);
      return { y, m: m - 1 };
    }
    return { y: today.getFullYear(), m: today.getMonth() };
  };
  const [ym, setYm] = useState(initMonth);
  const [sel, setSel] = useState<string | null>(null);
  if (events.length === 0) return null;

  const { y, m } = ym;
  const byDate = new Map<string, TimelineEvent[]>();
  for (const e of withDate) {
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }
  const firstWeekday = (new Date(y, m, 1).getDay() + 6) % 7; // 週一起
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: Array<number | null> = [...Array<null>(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const dstr = (d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const shift = (dir: -1 | 1) => {
    const nm = m + dir;
    setYm({ y: y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 });
    setSel(null);
  };
  const shown = sel ? (byDate.get(sel) ?? []) : [...withDate].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-3">
      <div className="rounded-xl border-2 border-[#e8dfd4] bg-white overflow-hidden max-w-sm">
        <div className="flex items-center justify-between px-3 py-2 border-b border-dashed border-[#e8dfd4]">
          <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm !px-2" aria-label="上個月" onClick={() => shift(-1)}>
            ‹
          </button>
          <span className="font-huninn">
            {y} 年 {m + 1} 月
          </span>
          <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm !px-2" aria-label="下個月" onClick={() => shift(1)}>
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 text-center font-mono2 text-[10px] text-[#6f6156] pt-2">
          {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1 p-2">
          {cells.map((d, i) => {
            if (d === null) return <div key={i} />;
            const ds = dstr(d);
            const evs = byDate.get(ds);
            const isToday = ds === todayStr;
            const isSel = sel === ds;
            return (
              <button
                key={i}
                type="button"
                disabled={!evs}
                onClick={() => setSel(isSel ? null : ds)}
                className={`aspect-square rounded-lg text-xs font-mono2 flex flex-col items-center justify-center gap-0.5 transition-colors
                  ${isSel ? 'bg-[#9e4b2c] text-[#fbf8f3]' : evs ? 'bg-[#f6efe4] font-bold hover:bg-[#f5aebd]/40' : 'text-[#6f6156]/70'}
                  ${isToday && !isSel ? 'ring-2 ring-[#24697f] ring-inset' : ''}`}
              >
                {d}
                {evs && <span className={`w-1.5 h-1.5 rounded-full ${isSel ? 'bg-[#fbf8f3]' : 'bg-[#9e4b2c]'}`} />}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="kg-seclabel">（{sel ? `${Number(sel.split('-')[1])} 月 ${Number(sel.split('-')[2])} 日的日程` : '日程表'}）</span>
          {sel && (
            <button type="button" className="font-mono2 text-[10px] text-[#24697f] hover:text-[#9e4b2c]" onClick={() => setSel(null)}>
              顯示全部 ✕
            </button>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-[#7a6f63]">（這天沒有日程）</p>
        ) : (
          <ol className="space-y-1.5">
            {shown.map((ev, i) => (
              <li key={i} className="flex items-baseline gap-2.5 text-sm">
                <span className="font-mono2 text-[11px] text-[#9e4b2c] shrink-0 w-[88px]">{ev.date}</span>
                <span className="font-bold shrink-0">{ev.title}</span>
                {ev.note && <span className="text-[#6f6156] text-xs">{ev.note}</span>}
              </li>
            ))}
          </ol>
        )}
        {noDate.length > 0 && !sel && (
          <ol className="space-y-1.5 mt-2 pt-2 border-t border-dashed border-[#e8dfd4]">
            {noDate.map((ev, i) => (
              <li key={i} className="flex items-baseline gap-2.5 text-sm">
                <span className="font-mono2 text-[11px] text-[#6f6156] shrink-0 w-[88px]">未定日期</span>
                <span className="font-bold shrink-0">{ev.title}</span>
                {ev.note && <span className="text-[#6f6156] text-xs">{ev.note}</span>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// 色票組
export function PaletteInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const colors = parsePalette(value);
  const set = (next: PaletteColor[]) => onChange(stringifyPalette(next));
  const patch = (i: number, p: Partial<PaletteColor>) => set(colors.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="space-y-1.5 pt-1">
      {colors.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(c.hex) ? c.hex : '#9e4b2c'}
            onChange={(e) => patch(i, { hex: e.target.value })}
            className="w-10 h-9 rounded-lg border-2 border-[#e8dfd4] cursor-pointer bg-white p-0.5 shrink-0"
          />
          <input className="kg-input !h-9 !w-24 text-sm" value={c.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="部位" maxLength={8} />
          <input className="kg-input !h-9 !w-24 font-mono2 text-sm" value={c.hex} onChange={(e) => patch(i, { hex: e.target.value })} placeholder="#2a2622" maxLength={7} />
          <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm text-[#a8455e] shrink-0" onClick={() => set(colors.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm border-dashed" onClick={() => set([...colors, { name: '', hex: '#9e4b2c' }])}>
        ＋ 新增顏色
      </button>
    </div>
  );
}

export function PaletteView({ value }: { value: string }) {
  const colors = paletteVisible(parsePalette(value));
  if (!colors.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {colors.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-[#e8dfd4] bg-white px-2 py-1">
          <span className="w-4 h-4 rounded-full border border-black/10 inline-block" style={{ background: c.hex }} />
          {c.name && <span className="text-xs font-bold">{c.name}</span>}
          <span className="font-mono2 text-[10px] text-[#6f6156]">{c.hex}</span>
        </span>
      ))}
    </div>
  );
}

// 單張圖片（欄位用；區塊的圖片是相簿，走 BlockFileInput）
export function SingleImageInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center gap-2 flex-wrap">
        {value && <img src={value} alt="" className="w-16 h-16 rounded-lg border-2 border-[#e8dfd4] object-cover" />}
        <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm" onClick={() => fileRef.current?.click()}>
          上傳圖片
        </button>
        {value && (
          <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm text-[#a8455e]" onClick={() => onChange('')}>
            移除
          </button>
        )}
      </div>
      {!value && (
        <div className="flex gap-2">
          <input className="kg-input font-mono2 text-xs flex-1" placeholder="或貼上圖片網址 https://…" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm shrink-0" disabled={!draft.trim()} onClick={() => onChange(draft.trim())}>
            加入
          </button>
        </div>
      )}
      {err && <p className="text-xs font-bold text-[#a8455e]">{err}</p>}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            onChange(await readImageFile(f));
            setErr(null);
          } catch (ex) {
            setErr(ex instanceof Error ? ex.message : '圖片讀取失敗');
          }
        }}
      />
    </div>
  );
}

// 音樂／影片：上傳小檔或貼連結
export function MediaInput({ kind, value, onChange }: { kind: 'audio' | 'video'; value: string; onChange: (v: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const label = kind === 'audio' ? '音樂' : '影片';
  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm" onClick={() => fileRef.current?.click()}>
          上傳{label}
        </button>
        {value && (
          <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm text-[#a8455e]" onClick={() => onChange('')}>
            移除
          </button>
        )}
        <span className="font-mono2 text-[11px] text-[#6f6156]">≤3.5MB，大檔請用連結</span>
      </div>
      {value ? (
        <MediaView kind={kind} value={value} />
      ) : (
        <div className="flex gap-2">
          <input className="kg-input font-mono2 text-xs flex-1" placeholder={`或貼上${label}網址 https://…`} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button type="button" className="kg-pill kg-pill-ghost kg-pill-sm shrink-0" disabled={!draft.trim()} onClick={() => onChange(draft.trim())}>
            加入
          </button>
        </div>
      )}
      {err && <p className="text-xs font-bold text-[#a8455e]">{err}</p>}
      <input
        ref={fileRef}
        type="file"
        accept={kind === 'audio' ? 'audio/mpeg,audio/wav,audio/ogg,audio/mp4' : 'video/mp4,video/webm'}
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            onChange(await readMediaFile(f, kind));
            setErr(null);
          } catch (ex) {
            setErr(ex instanceof Error ? ex.message : '檔案讀取失敗');
          }
        }}
      />
    </div>
  );
}

// URL 安全檢查：只允許 http/https，回傳规范化網址；其他協定回傳 null
export function safeHttpUrl(v: string): string | null {
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

// 影片連結轉嵌入網址（YouTube / Google Drive），轉不了就回傳 null 走 <video> 直連
export function videoEmbedUrl(v: string): string | null {
  try {
    const u = new URL(v);
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host === 'youtube.com') {
      const id = u.searchParams.get('v') ?? u.pathname.match(/\/(?:shorts|embed|live)\/([\w-]+)/)?.[1] ?? null;
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host === 'drive.google.com') {
      const m = u.pathname.match(/\/file\/d\/([\w-]+)/);
      return m ? `https://drive.google.com/file/d/${m[1]}/preview` : null;
    }
  } catch {
    /* 不是網址（上傳的 dataURL）就交給 <video> */
  }
  return null;
}

export function MediaView({ kind, value }: { kind: 'audio' | 'video'; value: string }) {
  if (!value) return null;
  if (kind === 'audio') {
    return <audio controls src={value} className="w-full" />;
  }
  const embed = videoEmbedUrl(value);
  if (embed) {
    return (
      <div className="relative w-full overflow-hidden rounded-xl border-2 border-[#e8dfd4] bg-black" style={{ aspectRatio: '16 / 9' }}>
        <iframe
          src={embed}
          title="影片預覽"
          className="absolute inset-0 h-full w-full"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  return <video controls src={value} className="w-full max-h-80 rounded-xl border-2 border-[#e8dfd4] bg-black" />;
}

// 關聯角色：連到企劃裡的其他角色（, 分隔角色 id）
export function CharRefInput({ value, onChange, roster }: { value: string; onChange: (v: string) => void; roster: RosterLite[] }) {
  const ids = parseCsv(value);
  const picked = ids.map((id) => roster.find((c) => c.id === id)).filter((c): c is RosterLite => !!c);
  const rest = roster.filter((c) => !ids.includes(c.id));
  return (
    <div className="space-y-2 pt-1">
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {picked.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-[#e8dfd4] bg-white pl-1 pr-2 py-1">
              <CharAvatar name={c.name} url={c.avatar_url} size={20} />
              <span className="text-xs font-bold">{c.name}</span>
              <button type="button" className="opacity-60 hover:opacity-100" onClick={() => onChange(ids.filter((x) => x !== c.id).join(','))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {rest.length > 0 ? (
        <select
          className="kg-select text-sm"
          value=""
          onChange={(e) => {
            if (e.target.value) onChange([...ids, e.target.value].join(','));
          }}
        >
          <option value="">＋ 選擇要連結的角色…</option>
          {rest.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}（{c.id}）
            </option>
          ))}
        </select>
      ) : (
        picked.length === 0 && <p className="font-mono2 text-[11px] text-[#6f6156]">企劃裡還沒有其他角色可以連結</p>
      )}
    </div>
  );
}

export function CharRefView({ value, slug, roster }: { value: string; slug?: string; roster: RosterLite[] }) {
  const ids = parseCsv(value);
  if (!ids.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {ids.map((id) => {
        const c = roster.find((x) => x.id === id);
        const chip = (
          <>
            <CharAvatar name={c?.name ?? '?'} url={c?.avatar_url} size={20} />
            <span className="text-xs font-bold">{c?.name ?? id}</span>
          </>
        );
        const cls = 'inline-flex items-center gap-1.5 rounded-full border border-[#e8dfd4] bg-white pl-1 pr-2.5 py-1';
        return c && slug ? (
          <a key={id} href={href(`/p/${slug}/c/${id}`)} className={`${cls} hover:border-[#9e4b2c]`}>
            {chip}
          </a>
        ) : (
          <span key={id} className={cls}>
            {chip}
          </span>
        );
      })}
    </div>
  );
}

// 文字顯示樣式（名帖：一般／引言／重點框／縮排卡片／展開才顯示）
export const FIELD_STYLES: Array<[FieldStyle, string]> = [
  ['normal', '一般'],
  ['quote', '引言'],
  ['box', '重點框'],
  ['indent', '縮排卡片'],
  ['collapse', '展開才顯示'],
];

export function StyledText({ text, style = 'normal' }: { text: string; style?: FieldStyle }) {
  if (style === 'quote') {
    return <blockquote className="border-l-4 border-[#9e4b2c] pl-3 py-0.5 text-[#5a4a3e] whitespace-pre-wrap">{text}</blockquote>;
  }
  if (style === 'box') {
    return <div className="rounded-xl border-2 border-[#9e4b2c] bg-[#fdf3ee] px-3.5 py-2.5 whitespace-pre-wrap">{text}</div>;
  }
  if (style === 'indent') {
    return <div className="ml-4 rounded-xl border border-[#e8dfd4] bg-white/70 px-3.5 py-2.5 whitespace-pre-wrap">{text}</div>;
  }
  if (style === 'collapse') {
    return (
      <details className="rounded-xl border border-dashed border-[#e8dfd4] px-3.5 py-2">
        <summary className="cursor-pointer font-mono2 text-xs text-[#6f6156] select-none">展開內容</summary>
        <div className="pt-2 whitespace-pre-wrap">{text}</div>
      </details>
    );
  }
  return <span className="whitespace-pre-wrap">{text}</span>;
}

// 依欄位類型渲染輸入控件（Join／CharEdit 共用）
export function FieldInput({ def, value, onChange, roster = [], id }: { def: FieldDef; value: string; onChange: (v: string) => void; roster?: RosterLite[]; id?: string }) {
  const t = fieldType(def);
  if (t === 'textarea') {
    return <ImeTextarea id={id} className="kg-textarea" rows={3} value={value} onChange={onChange} placeholder={def.placeholder} maxLength={1000} />;
  }
  if (t === 'tags') {
    return <TagsInput value={value} onChange={onChange} placeholder={def.placeholder} />;
  }
  if (t === 'checklist') {
    return <ChecklistInput value={value} onChange={onChange} />;
  }
  if (t === 'radar') {
    return <RadarInput value={value} onChange={onChange} />;
  }
  if (t === 'timeline' || t === 'calendar') {
    return <TimelineInput value={value} onChange={onChange} />;
  }
  if (t === 'palette') {
    return <PaletteInput value={value} onChange={onChange} />;
  }
  if (t === 'image') {
    return <SingleImageInput value={value} onChange={onChange} />;
  }
  if (t === 'audio' || t === 'video') {
    return <MediaInput kind={t} value={value} onChange={onChange} />;
  }
  if (t === 'charref') {
    return <CharRefInput value={value} onChange={onChange} roster={roster} />;
  }
  if (t === 'select') {
    return (
      <select id={id} className="kg-select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">（未選擇）</option>
        {(def.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (t === 'multiselect') {
    const sel = value ? value.split(',').filter(Boolean) : [];
    const toggle = (o: string) => onChange(sel.includes(o) ? sel.filter((x) => x !== o).join(',') : [...sel, o].join(','));
    return (
      <div className="flex flex-wrap gap-1.5 pt-1">
        {(def.options ?? []).map((o) => (
          <button
            key={o}
            type="button"
            className={`kg-pill kg-pill-sm ${sel.includes(o) ? 'kg-pill-ink' : 'kg-pill-ghost border !border-[#e8dfd4]'}`}
            onClick={() => toggle(o)}
          >
            {o}
          </button>
        ))}
      </div>
    );
  }
  if (t === 'rating') {
    const max = def.max ?? 5;
    const n = parseInt(value) || 0;
    return (
      <div className="flex items-center gap-1 pt-1.5">
        {Array.from({ length: max }, (_, k) => k + 1).map((i) => (
          <button
            key={i}
            type="button"
            aria-label={`${i} 星`}
            className={`${max > 5 ? 'text-xl' : 'text-2xl'} leading-none transition-colors ${i <= n ? 'text-[#9e4b2c]' : 'text-[#e8dfd4] hover:text-[#f5aebd]'}`}
            onClick={() => onChange(i === n ? '' : String(i))}
          >
            ★
          </button>
        ))}
        {n > 0 && (
          <span className="font-mono2 text-xs text-[#6f6156] ml-1">
            {n}/{max}
          </span>
        )}
      </div>
    );
  }
  if (t === 'color') {
    const v = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#9e4b2c';
    return (
      <div className="flex items-center gap-2">
        <input type="color" value={v} onChange={(e) => onChange(e.target.value)} className="w-11 h-10 rounded-lg border-2 border-[#e8dfd4] cursor-pointer bg-white p-1" />
        <input
          className="kg-input !w-auto flex-1 font-mono2 text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#2a2622"
          maxLength={7}
        />
      </div>
    );
  }
  const inputType = t === 'number' ? 'number' : t === 'date' ? 'date' : t === 'url' ? 'url' : 'text';
  if (t === 'number' || t === 'date' || t === 'url') {
    return <input id={id} className="kg-input" type={inputType} inputMode={t === 'url' ? 'url' : undefined} value={value} onChange={(e) => onChange(e.target.value)} placeholder={def.placeholder} maxLength={120} />;
  }
  return <ImeInput id={id} className="kg-input" value={value} onChange={onChange} placeholder={def.placeholder} maxLength={120} />;
}

export function SheetableField({
  def,
  value,
  onChange,
  roster = [],
  id,
}: {
  def: FieldDef;
  value: string;
  onChange: (v: string) => void;
  roster?: RosterLite[];
  id?: string;
}) {
  const t = fieldType(def);
  const [sheet, setSheet] = useState(false);
  const useSheet = t === 'textarea' || t === 'timeline' || t === 'calendar' || t === 'image' || t === 'palette';
  const editor = <FieldInput id={id} def={def} value={value} onChange={onChange} roster={roster} />;
  if (!useSheet) return editor;

  let preview: ReactNode = <span className="kg-fill-preview-empty">點擊編輯</span>;
  if (t === 'textarea') {
    preview = value.trim() ? (
      <span className="line-clamp-3 whitespace-pre-wrap">{value.trim()}</span>
    ) : (
      <span className="kg-fill-preview-empty">點擊寫長文</span>
    );
  } else if (t === 'timeline' || t === 'calendar') {
    const n = timelineVisible(parseTimeline(value)).length;
    preview = n ? <span>{n} 則</span> : <span className="kg-fill-preview-empty">點擊編輯</span>;
  } else if (t === 'image') {
    preview = value ? (
      <img src={value} alt="" className="h-16 rounded-lg object-cover border border-[#e8dfd4]" />
    ) : (
      <span className="kg-fill-preview-empty">點擊加入圖片</span>
    );
  } else if (t === 'palette') {
    const cols = paletteVisible(parsePalette(value));
    preview = cols.length ? (
      <span className="flex gap-1">
        {cols.slice(0, 6).map((c) => (
          <span key={c.hex} className="w-6 h-6 rounded-full border border-[#e8dfd4]" style={{ background: c.hex }} />
        ))}
      </span>
    ) : (
      <span className="kg-fill-preview-empty">點擊編輯色票</span>
    );
  }

  return (
    <>
      <button type="button" className="kg-fill-preview" onClick={() => setSheet(true)}>
        {preview}
      </button>
      {sheet && (
        <FillSheet title={def.label || '編輯'} onDone={() => setSheet(false)}>
          {editor}
        </FillSheet>
      )}
    </>
  );
}

// 依欄位類型渲染顯示（角色頁／企劃頁）
export function FieldView({ def, value, slug, roster = [] }: { def: FieldDef; value: string; slug?: string; roster?: RosterLite[] }) {
  const t = fieldType(def);
  if (t === 'checklist') return <ChecklistView value={value} />;
  if (t === 'radar') return <RadarChart dims={parseRadar(value)} />;
  if (t === 'timeline') return <TimelineView value={value} />;
  if (t === 'calendar') return <CalendarView value={value} />;
  if (t === 'palette') return <PaletteView value={value} />;
  if (t === 'image') {
    return value ? <img src={value} alt={def.label} className="max-h-64 rounded-xl border-2 border-[#e8dfd4] object-cover" /> : null;
  }
  if (t === 'audio' || t === 'video') return <MediaView kind={t} value={value} />;
  if (t === 'charref') return <CharRefView value={value} slug={slug} roster={roster} />;
  if (t === 'tags' || t === 'multiselect') {
    const items = value.split(',').map((s) => s.trim()).filter(Boolean);
    return (
      <div className="flex flex-wrap gap-1.5">
        {items.map((x) => (
          <span key={x} className="kg-tag">
            {x}
          </span>
        ))}
      </div>
    );
  }
  if (t === 'color') {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="w-6 h-6 rounded-md border-2 border-[#e8dfd4] inline-block" style={{ background: value }} />
        <span className="font-mono2 text-xs text-[#6f6156]">{value}</span>
      </span>
    );
  }
  if (t === 'url') {
    const safe = safeHttpUrl(value);
    // 只放行 http(s)；javascript: 等一律降級成純文字，不給點
    if (!safe) return <span className="break-all">{value}</span>;
    return (
      <a href={safe} target="_blank" rel="noreferrer noopener" className="text-[#24697f] underline break-all">
        {value}
      </a>
    );
  }
  if (t === 'rating') {
    const max = def.max ?? 5;
    const n = parseInt(value) || 0;
    return (
      <span className="text-lg tracking-wide">
        <span className="text-[#9e4b2c]">{'★'.repeat(n)}</span>
        <span className="text-[#e8dfd4]">{'★'.repeat(Math.max(0, max - n))}</span>
      </span>
    );
  }
  // text / textarea（含顯示樣式）
  return <StyledText text={value} style={def.style} />;
}

// ---------- 自訂角色欄位編輯器（類型／選項／必填／樣式／可見度） ----------
export function FieldsEditor({ value, onChange }: { value: FieldDef[]; onChange: (v: FieldDef[]) => void }) {
  const patch = (key: string, p: Partial<FieldDef>) => onChange(value.map((f) => (f.key === key ? { ...f, ...p } : f)));
  const addCommon = (label: string, def: Omit<FieldDef, 'key' | 'label'>) => {
    if (value.some((f) => f.label === label)) return;
    onChange([...value, { key: uid('f'), label, ...def }]);
  };
  return (
    <div>
      {value.map((f) => {
        const t = fieldType(f);
        const needsOptions = t === 'select' || t === 'multiselect';
        const isTexty = t === 'text' || t === 'textarea';
        const menu = [
          {
            label: (f.visibility ?? 'public') === 'private' ? '改為公開' : '改為私人',
            onClick: () => patch(f.key, { visibility: (f.visibility ?? 'public') === 'private' ? 'public' : 'private' }),
          },
          { label: f.required ? '取消必填' : '設為必填', onClick: () => patch(f.key, { required: !f.required }) },
          ...(isTexty
            ? FIELD_STYLES.map(([v, label]) => ({
                label: `樣式：${label}`,
                onClick: () => patch(f.key, { style: v }),
              }))
            : []),
          ...(t === 'rating'
            ? [3, 5, 10].map((m) => ({
                label: `滿分 ${m}`,
                onClick: () => patch(f.key, { max: m }),
              }))
            : []),
          { label: '刪除欄位', onClick: () => onChange(value.filter((x) => x.key !== f.key)), danger: true },
        ];
        return (
          <div key={f.key} className="kg-field space-y-2">
            <div className="flex items-center gap-2">
              <input
                className="kg-input !h-10 !w-auto flex-1 min-w-0 text-sm font-bold"
                value={f.label}
                onChange={(e) => patch(f.key, { label: e.target.value })}
                placeholder="欄位名稱"
                maxLength={12}
              />
              <select
                className="kg-select !h-10 !w-auto max-w-[42%] text-sm !py-0"
                value={t}
                aria-label="欄位型別"
                onChange={(e) => patch(f.key, { type: e.target.value as FieldDef['type'] })}
              >
                {FIELD_TYPE_GROUPS.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.items.map((it) => (
                      <option key={it.value} value={it.value}>
                        {it.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {(f.visibility ?? 'public') === 'private' && (
                <span className="font-mono2 text-[10px] text-[#a8455e] shrink-0">🔒</span>
              )}
              {f.required && <span className="font-mono2 text-[10px] text-[#9e4b2c] shrink-0">必填</span>}
              <RowMenu items={menu} />
            </div>
            {needsOptions && (
              <input
                className="kg-input !h-10 font-mono2 text-xs"
                value={(f.options ?? []).join(',')}
                onChange={(e) => patch(f.key, { options: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })}
                placeholder="選項，逗號分隔：人類,精靈"
              />
            )}
          </div>
        );
      })}
      <div className="flex items-center gap-1.5 flex-wrap pt-3">
        <span className="font-mono2 text-[11px] text-[#6f6156]">常見欄位</span>
        {COMMON_FIELDS.map(({ label, def }) => {
          const exists = value.some((f) => f.label === label);
          return (
            <button
              key={label}
              type="button"
              disabled={exists}
              className={`kg-pill kg-pill-sm border-dashed ${exists ? 'kg-pill-ghost opacity-40' : 'kg-pill-ghost'}`}
              onClick={() => addCommon(label, def)}
            >
              ＋ {label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="kg-pill kg-pill-ghost kg-pill-sm border-dashed mt-2"
        onClick={() => onChange([...value, { key: uid('f'), label: '', type: 'text', placeholder: '', required: false }])}
      >
        ＋ 新增欄位
      </button>
      <p className="font-mono2 text-[11px] text-[#6f6156] mt-2">＊ 刪除欄位不會清掉角色已填的資料，只是不再顯示。私人欄位只有本人與開設者看得見。</p>
    </div>
  );
}

// ---------- 牽線「其他補充」區塊編輯器（純文字） ----------
export function ExtrasEditor({ value, onChange }: { value: RelationExtra[]; onChange: (v: RelationExtra[]) => void }) {
  const patch = (id: string, p: Partial<RelationExtra>) => onChange(value.map((x) => (x.id === id ? { ...x, ...p } : x)));
  return (
    <div className="space-y-3">
      {value.map((x) => (
        <div key={x.id} className="kg-card-flat p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <ImeInput
              className="kg-input !w-auto flex-1 font-bold"
              value={x.title}
              onChange={(v) => patch(x.id, { title: v })}
              placeholder="區塊標題（如：兩人的回憶）"
              maxLength={20}
            />
            <button
              type="button"
              className="kg-pill kg-pill-ghost kg-pill-sm text-[#a8455e] shrink-0"
              onClick={() => onChange(value.filter((y) => y.id !== x.id))}
            >
              刪除
            </button>
          </div>
          <ImeTextarea
            className="kg-textarea"
            rows={3}
            value={x.content}
            onChange={(v) => patch(x.id, { content: v })}
            placeholder="補充內容…"
            maxLength={1000}
          />
        </div>
      ))}
      <button
        type="button"
        className="kg-pill kg-pill-ghost kg-pill-sm border-dashed"
        onClick={() => onChange([...value, { id: uid('ex'), title: '', content: '' }])}
      >
        ＋ 新增區塊
      </button>
    </div>
  );
}
