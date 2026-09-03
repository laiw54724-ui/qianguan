import { useRef, useState } from "react";
import {
  PLATFORM_META,
  PLATFORM_ORDER,
  MAX_LINKS,
  detectPlatform,
  displayLabel,
  normalizeUrl,
  type PlatformId,
  type SocialLink,
} from "../lib/links";
import { uid } from "../lib/uid";
import { fetchLinkPreview } from "../lib/api";

function PlatformGlyph({ platform }: { platform: PlatformId }) {
  const common = { viewBox: "0 0 24 24", width: 14, height: 14, fill: "currentColor", "aria-hidden": true as const };
  switch (platform) {
    case "facebook":
      return (
        <svg {...common}>
          <path d="M14 8h3V4h-3c-2.8 0-5 2.2-5 5v2H6v4h3v7h4v-7h3l1-4h-4V9c0-.6.4-1 1-1z" />
        </svg>
      );
    case "instagram":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "threads":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8 7c2-3 8-3 9 2 1 6-4 10-8 8 5 1 8-3 7-7-1-3-4-3-5 0" />
        </svg>
      );
    case "plurk":
      return (
        <svg {...common}>
          <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm.2 13.2c-2.6 0-4.4-1.6-4.4-4.2 0-2.7 1.8-4.4 4.5-4.4 1.6 0 2.7.6 3.4 1.5l-1.6 1.3c-.4-.6-1-.9-1.8-.9-1.4 0-2.3 1-2.3 2.5s.9 2.5 2.3 2.5c.8 0 1.4-.3 1.8-1l1.6 1.2c-.7 1-1.9 1.5-3.5 1.5z" />
        </svg>
      );
    case "google":
      return (
        <svg {...common}>
          <path d="M12 11.5v2.7h6.1c-.2 1.4-1.6 4-6.1 4A6.6 6.6 0 1 1 12 5.4c1.9 0 3.2.8 3.9 1.5l2-2C16.6 3.6 14.5 2.6 12 2.6 6.9 2.6 2.8 6.7 2.8 11.8S6.9 21 12 21c5.2 0 8.6-3.6 8.6-8.7 0-.6 0-1-.1-1.5H12z" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="M14.5 10.3 22 2h-2.2l-6.4 7.1L8.4 2H2l7.9 11.2L2 22h2.2l6.9-7.7L15.6 22H22l-7.5-11.7z" />
        </svg>
      );
    case "youtube":
      return (
        <svg {...common}>
          <path d="M23 12.2s0-3.2-.4-4.6c-.2-.9-.9-1.6-1.8-1.8C19.2 5.4 12 5.4 12 5.4s-7.2 0-8.8.4c-.9.2-1.6.9-1.8 1.8C1 9 1 12.2 1 12.2s0 3.2.4 4.6c.2.9.9 1.6 1.8 1.8 1.6.4 8.8.4 8.8.4s7.2 0 8.8-.4c.9-.2 1.6-.9 1.8-1.8.4-1.4.4-4.6.4-4.6zM9.8 15.6V8.8l6.2 3.4-6.2 3.4z" />
        </svg>
      );
    case "discord":
      return (
        <svg {...common}>
          <path d="M19.5 5.2A17 17 0 0 0 15.3 4l-.2.4c1.6.5 2.5 1.1 3.3 1.9-1.4-.7-2.8-1.2-4.3-1.4-.7-.1-1.4-.2-2.1-.2s-1.4.1-2.1.2c-1.5.2-2.9.7-4.3 1.4.8-.8 1.8-1.4 3.3-1.9L8.7 4A17 17 0 0 0 4.5 5.2C2.2 8.6 1.6 11.9 1.8 15.2c1.8 1.3 3.5 2.1 5.2 2.6l.7-1.1c-1.2-.4-2.2-.9-3.1-1.6 2.4 1.1 4.8 1.6 7.5 1.6s5.1-.5 7.5-1.6c.3-.1.6-.3.9-.5-.9.7-1.9 1.2-3.1 1.6l.7 1.1c1.7-.5 3.4-1.3 5.2-2.6.3-3.8-.5-7.1-2.7-10zm-10 8.3c-.8 0-1.5-.8-1.5-1.7s.7-1.7 1.5-1.7 1.5.8 1.5 1.7-.7 1.7-1.5 1.7zm5 0c-.8 0-1.5-.8-1.5-1.7s.7-1.7 1.5-1.7 1.5.8 1.5 1.7-.7 1.7-1.5 1.7z" />
        </svg>
      );
    case "pixiv":
      return (
        <svg {...common}>
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1.2 14.6H9.4V7.4h3.8c2.3 0 3.8 1.4 3.8 3.6 0 2.3-1.6 3.6-3.8 3.6zm0-8.4h-1.6v5.6h1.6c1.4 0 2.2-.8 2.2-2.8s-.8-2.8-2.2-2.8z" />
        </svg>
      );
    default:
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10 13a5 5 0 0 0 7.1.1l1.8-1.8a5 5 0 0 0-7.1-7.1L10.7 5" />
          <path d="M14 11a5 5 0 0 0-7.1-.1L5.1 12.7a5 5 0 0 0 7.1 7.1L13.3 19" />
        </svg>
      );
  }
}

export function SocialLinkChips({ links, compact }: { links?: SocialLink[] | null; compact?: boolean }) {
  const items = (links ?? []).filter((l) => l.url);
  if (!items.length) return null;
  const shown = compact ? items.slice(0, 2) : items;
  const extra = compact ? items.length - shown.length : 0;
  return (
    <div className={`flex flex-wrap ${compact ? "gap-1.5 mt-2" : "gap-2"}`}>
      {shown.map((l) => (
        <a
          key={l.id}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className="kg-linkchip"
          title={l.url}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="kg-linkchip-ico">
            <PlatformGlyph platform={l.platform} />
          </span>
          <span className="kg-linkchip-label">{displayLabel(l)}</span>
        </a>
      ))}
      {extra > 0 && <span className="kg-linkchip kg-linkchip-more">+{extra}</span>}
    </div>
  );
}

export function SocialLinksEditor({
  value,
  onChange,
  hideIntro,
}: {
  value: SocialLink[];
  onChange: (next: SocialLink[]) => void;
  hideIntro?: boolean;
}) {
  const fetching = useRef<Record<string, number>>({});
  const valueRef = useRef(value);
  valueRef.current = value;
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const filled = value.filter((l) => l.url.trim());

  const patch = (id: string, part: Partial<SocialLink>) => {
    onChange(valueRef.current.map((l) => (l.id === id ? { ...l, ...part } : l)));
  };

  const ingest = async (raw: string) => {
    const url = raw.trim() ? normalizeUrl(raw.trim()) : "";
    if (!url) return;
    if (filled.length >= MAX_LINKS) return;
    const id = uid("lnk_");
    const detected = detectPlatform(url);
    onChange([...filled, { id, platform: detected, label: "", url }]);
    setDraft("");
    setEditing(id);
    const n = (fetching.current[id] = (fetching.current[id] ?? 0) + 1);
    try {
      const r = await fetchLinkPreview(url);
      if (fetching.current[id] !== n) return;
      const title = (r.title ?? "").trim();
      if (!title) return;
      const cur = valueRef.current.find((l) => l.id === id);
      patch(id, {
        previewTitle: title,
        label: cur?.label.trim() ? cur.label : title,
      });
    } catch {
      /* 抓不到標題就只留平台偵測 */
    }
  };

  const applyUrl = async (id: string, raw: string, currentLabel: string) => {
    const url = raw.trim() ? normalizeUrl(raw) : "";
    if (!url) {
      patch(id, { url: raw });
      return;
    }
    const detected = detectPlatform(url);
    patch(id, { url, platform: detected });
    const n = (fetching.current[id] = (fetching.current[id] ?? 0) + 1);
    try {
      const r = await fetchLinkPreview(url);
      if (fetching.current[id] !== n) return;
      const title = (r.title ?? "").trim();
      if (!title) return;
      patch(id, {
        url,
        platform: detected,
        previewTitle: title,
        label: currentLabel.trim() ? currentLabel : title,
      });
    } catch {
      /* ignore */
    }
  };

  const editingRow = filled.find((l) => l.id === editing);

  return (
    <div className="space-y-3">
      {!hideIntro && (
        <div>
          <div className="kg-seclabel">（對外連結）</div>
          <p className="text-sm text-[#6f6156] mt-1.5 leading-relaxed">貼上網址會變成一顆平台標籤；點標籤可改顯示名稱。</p>
        </div>
      )}
      {filled.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {filled.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`kg-linkchip ${editing === l.id ? "ring-2 ring-[#9e4b2c]" : ""}`}
              onClick={() => setEditing(editing === l.id ? null : l.id)}
            >
              <span className="kg-linkchip-ico">
                <PlatformGlyph platform={l.platform} />
              </span>
              <span className="kg-linkchip-label">{displayLabel(l)}</span>
            </button>
          ))}
        </div>
      )}
      {editingRow && (
        <div className="space-y-2">
          <select
            className="kg-select"
            value={editingRow.platform}
            aria-label="平台"
            onChange={(e) => patch(editingRow.id, { platform: e.target.value as PlatformId })}
          >
            {PLATFORM_ORDER.map((id) => (
              <option key={id} value={id}>
                {PLATFORM_META[id].name}
              </option>
            ))}
          </select>
          <input
            className="kg-input"
            value={editingRow.label}
            maxLength={80}
            placeholder={editingRow.previewTitle || `${PLATFORM_META[editingRow.platform].name}顯示名稱`}
            onChange={(e) => patch(editingRow.id, { label: e.target.value })}
          />
          <input
            className="kg-input font-mono2"
            value={editingRow.url}
            maxLength={2000}
            placeholder="https://…"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onBlur={(e) => applyUrl(editingRow.id, e.target.value, editingRow.label)}
            onChange={(e) => {
              const url = e.target.value;
              patch(editingRow.id, { url, platform: detectPlatform(url) });
            }}
          />
          <button
            type="button"
            className="kg-pill kg-pill-ghost kg-pill-sm text-[#a8455e]"
            onClick={() => {
              onChange(valueRef.current.filter((x) => x.id !== editingRow.id));
              setEditing(null);
            }}
          >
            刪除這條
          </button>
        </div>
      )}
      {filled.length < MAX_LINKS ? (
        <input
          className="kg-input font-mono2"
          value={draft}
          maxLength={2000}
          placeholder="貼上 https://…"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (text) {
              e.preventDefault();
              void ingest(text);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void ingest(draft);
            }
          }}
          onBlur={() => {
            if (draft.trim()) void ingest(draft);
          }}
        />
      ) : (
        <p className="font-mono2 text-[11px] text-[#6f6156]">最多 {MAX_LINKS} 條。</p>
      )}
    </div>
  );
}

