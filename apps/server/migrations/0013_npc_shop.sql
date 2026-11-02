-- NPC shop (chapter 06): buying ordinary goods for coins. service_operations gains the kind; SQLite
-- cannot change a CHECK in place, so the table is rebuilt with the same rows. The starter kit needs
-- no schema: its rows are keyed on the character id in the existing ledgers.
CREATE TABLE service_operations_v5 (
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  operation_id  TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('npc_sell', 'sigil_install', 'sigil_remove', 'companion_rebirth', 'skill_train', 'rebirth_branch', 'npc_buy')),
  request_hash  TEXT NOT NULL,
  result_json   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (account_id, operation_id)
);
INSERT INTO service_operations_v5 SELECT account_id, operation_id, kind, request_hash, result_json, created_at FROM service_operations;
DROP TABLE service_operations;
ALTER TABLE service_operations_v5 RENAME TO service_operations;
