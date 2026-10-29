-- Reset scrolls (Nut 2026-10-09 17:14Z, reset.ts): one row per use, keyed on the request's operation id,
-- so a retried use returns the stored result and never spends a second scroll.
CREATE TABLE character_resets (
  character_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('stats', 'skills')),
  request_hash TEXT NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (character_id, operation_id)
);
