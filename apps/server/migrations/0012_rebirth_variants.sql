-- Rebirth variants (chapter 04 §7): the branch picked per stage lives on the instance as JSON
-- ({"1":"A"}). service_operations gains the branch-change kind (a coin sink); SQLite cannot change a
-- CHECK in place, so the table is rebuilt with the same rows.
ALTER TABLE monster_instances ADD COLUMN rebirth_choices_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE service_operations_v4 (
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  operation_id  TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('npc_sell', 'sigil_install', 'sigil_remove', 'companion_rebirth', 'skill_train', 'rebirth_branch')),
  request_hash  TEXT NOT NULL,
  result_json   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (account_id, operation_id)
);
INSERT INTO service_operations_v4 SELECT account_id, operation_id, kind, request_hash, result_json, created_at FROM service_operations;
DROP TABLE service_operations;
ALTER TABLE service_operations_v4 RENAME TO service_operations;
