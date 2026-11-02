-- Divine awakening จุติเทพ (ascension.ts, P31): the path a character took after winning its race's
-- trial at Lv200 (paid for at the claim), and the operation that claimed it. service_operations gains
-- the claim and the path switch (rebuilt, same rows).
ALTER TABLE characters ADD COLUMN ascension_id TEXT;
ALTER TABLE characters ADD COLUMN ascension_operation_id TEXT;

CREATE TABLE service_operations_v8 (
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  operation_id  TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('npc_sell', 'sigil_install', 'sigil_remove', 'companion_rebirth', 'skill_train', 'rebirth_branch', 'npc_buy', 'affix_reroll', 'affix_choose', 'craft', 'ascend', 'ascend_switch')),
  request_hash  TEXT NOT NULL,
  result_json   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (account_id, operation_id)
);
INSERT INTO service_operations_v8 SELECT account_id, operation_id, kind, request_hash, result_json, created_at FROM service_operations;
DROP TABLE service_operations;
ALTER TABLE service_operations_v8 RENAME TO service_operations;
