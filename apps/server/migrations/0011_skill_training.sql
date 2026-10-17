-- Companion skill levels and Bond (chapter 04 §5–§6). Unspent mastery from won fights lives on the
-- instance; trained levels stay in trained_skill_levels_json. service_operations gains the training
-- kind; SQLite cannot change a CHECK in place, so the table is rebuilt with the same rows.
ALTER TABLE monster_instances ADD COLUMN skill_mastery INTEGER NOT NULL DEFAULT 0 CHECK (skill_mastery >= 0);

CREATE TABLE service_operations_v3 (
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  operation_id  TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('npc_sell', 'sigil_install', 'sigil_remove', 'companion_rebirth', 'skill_train')),
  request_hash  TEXT NOT NULL,
  result_json   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (account_id, operation_id)
);
INSERT INTO service_operations_v3 SELECT account_id, operation_id, kind, request_hash, result_json, created_at FROM service_operations;
DROP TABLE service_operations;
ALTER TABLE service_operations_v3 RENAME TO service_operations;
