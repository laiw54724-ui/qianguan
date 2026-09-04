CREATE TABLE private_relations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     TEXT NOT NULL REFERENCES projects(id),
  owner_char_id  TEXT NOT NULL REFERENCES characters(id),
  ghost_name     TEXT NOT NULL,
  label          TEXT NOT NULL DEFAULT '',
  note           TEXT NOT NULL DEFAULT '',
  linked_char_id TEXT REFERENCES characters(id),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_priv ON private_relations(owner_char_id);
