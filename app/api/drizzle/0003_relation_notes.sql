CREATE TABLE relation_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  relation_id INTEGER NOT NULL REFERENCES relations(id),
  body        TEXT NOT NULL,
  author_side TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_rnotes ON relation_notes(relation_id, created_at);
ALTER TABLE relations DROP COLUMN extras;
