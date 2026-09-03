-- 牽關 v1 初始遷移（對應 api/src/db/schema.ts；規格 §3.1 + 原型已上線欄位）
CREATE TABLE projects (
  id                TEXT PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  summary           TEXT NOT NULL DEFAULT '',
  world_note        TEXT NOT NULL DEFAULT '',
  world_blocks      TEXT NOT NULL DEFAULT '[]',
  qa                TEXT NOT NULL DEFAULT '[]',
  cover_url         TEXT,
  icon_url          TEXT,
  visibility        TEXT NOT NULL DEFAULT 'unlisted',
  join_mode         TEXT NOT NULL DEFAULT 'open',
  join_code_hash    TEXT,
  signups_open      INTEGER NOT NULL DEFAULT 1,
  owner_token_hash  TEXT NOT NULL,
  owner_discord_id  TEXT,
  transfer_code_hash TEXT,
  is_verified       INTEGER NOT NULL DEFAULT 0,
  announcement      TEXT,
  field_schema      TEXT NOT NULL DEFAULT '[]',
  rev               INTEGER NOT NULL DEFAULT 1,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE characters (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  name            TEXT NOT NULL,
  one_liner       TEXT NOT NULL DEFAULT '',
  avatar_url      TEXT,
  profile         TEXT NOT NULL DEFAULT '{}',
  blocks          TEXT NOT NULL DEFAULT '[]',
  edit_token_hash TEXT NOT NULL,
  discord_id      TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_char_project ON characters(project_id, status);
CREATE INDEX idx_char_discord ON characters(discord_id);

CREATE TABLE relations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  a_id        TEXT NOT NULL REFERENCES characters(id),
  b_id        TEXT NOT NULL REFERENCES characters(id),
  a_label     TEXT NOT NULL DEFAULT '',
  a_note      TEXT NOT NULL DEFAULT '',
  b_label     TEXT NOT NULL DEFAULT '',
  b_note      TEXT NOT NULL DEFAULT '',
  extras      TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'pending',
  initiator   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  CHECK (a_id < b_id)
);
CREATE UNIQUE INDEX idx_rel_pair ON relations(a_id, b_id);
CREATE INDEX idx_rel_project ON relations(project_id, status);
CREATE INDEX idx_rel_b ON relations(b_id);

CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  type        TEXT NOT NULL,
  actor_id    TEXT,
  target_id   TEXT,
  payload     TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_event_feed ON events(project_id, created_at DESC);
