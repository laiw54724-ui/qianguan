export type PlatformId =
  | "facebook"
  | "instagram"
  | "threads"
  | "plurk"
  | "google"
  | "x"
  | "youtube"
  | "discord"
  | "pixiv"
  | "custom";

export interface SocialLink {
  id: string;
  platform: PlatformId;
  label: string;
  url: string;
  previewTitle?: string;
}

export const PLATFORM_META: Record<PlatformId, { name: string }> = {
  facebook: { name: "Facebook" },
  instagram: { name: "Instagram" },
  threads: { name: "Threads" },
  plurk: { name: "噗浪" },
  google: { name: "Google" },
  x: { name: "X" },
  youtube: { name: "YouTube" },
  discord: { name: "Discord" },
  pixiv: { name: "Pixiv" },
  custom: { name: "其他" },
};

export const PLATFORM_ORDER: PlatformId[] = [
  "instagram",
  "threads",
  "plurk",
  "facebook",
  "google",
  "x",
  "youtube",
  "discord",
  "pixiv",
  "custom",
];

export const MAX_LINKS = 8;

export function detectPlatform(raw: string): PlatformId {
  const host = hostOf(raw);
  if (!host) return "custom";
  if (host === "facebook.com" || host === "fb.com" || host === "fb.me" || host === "m.facebook.com")
    return "facebook";
  if (host === "instagram.com") return "instagram";
  if (host === "threads.net" || host === "threads.com") return "threads";
  if (host === "plurk.com") return "plurk";
  if (host === "google.com" || host.endsWith(".google.com") || host === "forms.gle" || host === "goo.gl")
    return "google";
  if (host === "x.com" || host === "twitter.com" || host === "t.co") return "x";
  if (host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com") return "youtube";
  if (host === "discord.com" || host === "discord.gg") return "discord";
  if (host === "pixiv.net") return "pixiv";
  return "custom";
}

export function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  if (/^\/\//.test(t)) return `https:${t}`;
  return `https://${t}`;
}

export function isSafeHttpUrl(raw: string): boolean {
  try {
    const u = new URL(normalizeUrl(raw));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function displayLabel(link: SocialLink): string {
  const label = link.label.trim();
  if (label) return label;
  const preview = (link.previewTitle ?? "").trim();
  if (preview) return preview;
  return PLATFORM_META[link.platform]?.name ?? "連結";
}

export function sanitizeLinks(input: unknown): SocialLink[] {
  if (!Array.isArray(input)) return [];
  const out: SocialLink[] = [];
  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const url = typeof r.url === "string" ? normalizeUrl(r.url) : "";
    if (!url || !isSafeHttpUrl(url)) continue;
    const platform = coercePlatform(typeof r.platform === "string" ? r.platform : detectPlatform(url));
    const id = typeof r.id === "string" && r.id.trim() ? r.id.trim().slice(0, 64) : `lnk_${out.length}`;
    const label = typeof r.label === "string" ? r.label.trim().slice(0, 80) : "";
    const previewTitle = typeof r.previewTitle === "string" ? r.previewTitle.trim().slice(0, 200) : "";
    out.push({ id, platform, label, url: url.slice(0, 2000), previewTitle: previewTitle || undefined });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

function coercePlatform(v: string): PlatformId {
  return (PLATFORM_ORDER as string[]).includes(v) ? (v as PlatformId) : "custom";
}

function hostOf(raw: string): string {
  try {
    return new URL(normalizeUrl(raw)).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}
