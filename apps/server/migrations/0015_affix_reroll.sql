-- Affix reroll (chapter 05 §3): a paid roll for one affix waits on the piece until the player keeps
-- the old or the new one. service_operations gains the two kinds (table rebuilt, same rows).
ALTER TABLE equipment_instances ADD COLUMN affix_pending_json TEXT;

CREATE TABLE service_operations_v6 (
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  operation_id  TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('npc_sell', 'sigil_install', 'sigil_remove', 'companion_rebirth', 'skill_train', 'rebirth_branch', 'npc_buy', 'affix_reroll', 'affix_choose')),
  request_hash  TEXT NOT NULL,
  result_json   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (account_id, operation_id)
);
INSERT INTO service_operations_v6 SELECT account_id, operation_id, kind, request_hash, result_json, created_at FROM service_operations;
DROP TABLE service_operations;
ALTER TABLE service_operations_v6 RENAME TO service_operations;
