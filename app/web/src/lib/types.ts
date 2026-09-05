// 資料模型 — 對應架構規格 §3.1 DDL
import type { SocialLink } from "./links";

export type Visibility = 'public' | 'unlisted';
export type JoinMode = 'open' | 'code';
export type CharStatus = 'active' | 'draft' | 'removed';
export type RelStatus = 'pending' | 'accepted' | 'declined';
export type EventType = 'char_joined' | 'char_updated' | 'relation_accepted' | 'announcement';

// 世界觀 / 角色卡 / 牽線共用的內容區塊
// 區塊＝容器，裡面可放多個自訂欄位（名帖式）；每個欄位有型別與顯示設定
export type GalleryLayout = 'carousel' | 'grid' | 'swipe'; // swipe＝無邊框滿版左右滑動（Ticket-15）
export type BlockFieldType = FieldType | 'pdf';

// 相簿的一張圖片。舊資料是純字串陣列（Ticket-15 之前），讀取端一律用
// normalizeGalleryImages() 統一轉成這個形狀，寫入時一律存這個形狀，不用遷移舊資料。
export interface GalleryImage {
  url: string;
  caption?: string;
}

// 區塊內的一個欄位
export interface BlockField {
  id: string;
  label: string; // 可留空＝不顯示標籤
  type: BlockFieldType;
  content: string; // text→內文；pdf→dataURL/網址；image→首圖（相容）；結構化型別→JSON 字串
  style?: FieldStyle; // text / textarea 的顯示樣式
  visibility?: 'public' | 'private'; // private＝只有本人與開設者看得見
  images?: (string | GalleryImage)[]; // image→整組相簿；混合型別是相容舊資料，見 GalleryImage
  layout?: GalleryLayout; // image→呈現方式
  fileName?: string; // pdf
  max?: number; // rating 的滿分（3 / 5 / 10）
  options?: string[]; // select / multiselect 的選項
  placeholder?: string;
}

export interface WorldBlock {
  id: string;
  title: string;
  fields: BlockField[];
}

// 企劃問答
export interface QaItem {
  id: string;
  q: string;
  a: string;
  tags?: string[];
}

// 企劃分類詞庫（陣營／種族…）；角色與問答共用
export interface TagGroup {
  id: string;
  name: string;
  tags: string[];
  required?: boolean;
}

// 牽線雙方共用的互動筆記（1.5-1，取代原本的 RelationExtra）
export interface RelationNote {
  id: number;
  body: string;
  author_side: 'a' | 'b';
  created_at: number;
}

// 單人可用性的私人紀錄（1.5-2，取代原本的 draft-char）——只有 owner_char_id 對應的角色本人看得到
export interface PrivateRelation {
  id: number;
  ghost_name: string;
  label: string;
  note: string;
  linked_char_id: string | null;
  suggested_char_id: string | null;
  created_at: number;
  updated_at: number;
}

// 角色自訂欄位類型（名帖式）— 區塊與欄位共用
export type FieldType =
  | 'text' // 短文字
  | 'textarea' // 長文字
  | 'tags' // 標籤（, 分隔儲存）
  | 'select' // 單選
  | 'multiselect' // 多選（, 分隔儲存）
  | 'checklist' // 核取清單（JSON: ChecklistItem[]）
  | 'number'
  | 'date'
  | 'rating' // 星級 1..max（預設 5）
  | 'radar' // 五維雷達（JSON: RadarDim[]）
  | 'timeline' // 時間線（JSON: TimelineEvent[]）
  | 'calendar' // 行事曆：月曆標記重要日期＋日程表（JSON: TimelineEvent[]）
  | 'color'
  | 'palette' // 色票組（JSON: PaletteColor[]）
  | 'image' // 圖片（欄位＝單張；區塊＝相簿）
  | 'audio' // 音樂（dataURL 或網址）
  | 'video' // 影片（dataURL 或網址）
  | 'url' // 連結
  | 'charref'; // 關聯角色（, 分隔的角色 id）

// 文字的顯示樣式（名帖式）
export type FieldStyle = 'normal' | 'quote' | 'box' | 'indent' | 'collapse';

export interface FieldDef {
  key: string;
  label: string;
  type?: FieldType; // 預設 text
  options?: string[]; // select / multiselect 的選項
  placeholder?: string;
  required?: boolean;
  max?: number; // rating 的滿分（3 / 5 / 10）
  style?: FieldStyle; // text / textarea 的顯示樣式
  visibility?: 'public' | 'private'; // private＝只有本人與開設者看得見
}

// 結構化欄位值（以 JSON 字串存進 profile / block.content）
export interface ChecklistItem {
  text: string;
  done: boolean;
}
export interface RadarDim {
  label: string;
  value: number; // 0..5
}
export interface TimelineEvent {
  date: string;
  title: string;
  note?: string;
}
export interface PaletteColor {
  name: string;
  hex: string;
}

export type { PlatformId, SocialLink } from "./links";

export interface Project {
  id: string; // prj_xxxxxxxx
  slug: string;
  title: string;
  summary: string;
  world_note: string; // 舊版純文字世界觀（遷移後僅作備援）
  world_blocks: WorldBlock[];
  qa: QaItem[];
  cover_url: string | null;
  icon_url: string | null; // 企劃頭像（方形小圖）
  visibility: Visibility;
  join_mode: JoinMode;
  has_join_code: boolean;
  signups_open: boolean;
  is_verified: boolean;
  announcement: string | null;
  field_schema: FieldDef[];
  tag_groups?: TagGroup[];
  links?: SocialLink[];
  rev: number;
  created_at: number;
  updated_at: number;
}

export interface Character {
  id: string; // 公開短碼 BY-7Q1M
  project_id: string;
  name: string;
  one_liner: string;
  avatar_url: string | null;
  profile: Record<string, string>;
  blocks: WorldBlock[];
  links?: SocialLink[];
  tags?: string[];
  status: CharStatus;
  created_at: number;
  updated_at: number;
}

export interface Relation {
  id: number;
  project_id: string;
  a_id: string; // 正規化：a_id < b_id
  b_id: string;
  a_label: string;
  a_note: string;
  b_label: string;
  b_note: string;
  notes: RelationNote[]; // 雙方共用的互動筆記（accepted 之後才有，1.5-1）
  status: RelStatus;
  initiator: 'a' | 'b';
  created_at: number;
  updated_at: number;
}

export interface KgEvent {
  id: number;
  project_id: string;
  type: EventType;
  actor_id: string | null;
  target_id: string | null;
  payload: Record<string, string>;
  created_at: number;
}

export interface Db {
  projects: Project[];
  characters: Character[];
  relations: Relation[];
  events: KgEvent[];
  seq: number; // AUTOINCREMENT 模擬
}
