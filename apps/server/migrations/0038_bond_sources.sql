-- Bond beyond won fights (chapter 04 §6, P35): first visit to a map, first win against a boss, and
-- favourite gifts. One-time sources are kept per companion and owner (a new owner starts over, as Bond
-- resets on transfer). `token` marks which write inserted the row, so the Bond that goes with it lands
-- in the same batch exactly once.
CREATE TABLE companion_firsts (
  instance_id  TEXT NOT NULL,
  owner_id     TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('map', 'boss')),
  key          TEXT NOT NULL,
  token        TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (instance_id, owner_id, kind, key)
);

-- Favourite gifts: Bond given by gifts under this owner, and won fights since the last gift.
ALTER TABLE monster_instances ADD COLUMN gift_bond INTEGER NOT NULL DEFAULT 0 CHECK (gift_bond >= 0);
ALTER TABLE monster_instances ADD COLUMN wins_since_gift INTEGER NOT NULL DEFAULT 0 CHECK (wins_since_gift >= 0);

CREATE TABLE service_operations_v9 (
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  operation_id  TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('npc_sell', 'sigil_install', 'sigil_remove', 'companion_rebirth', 'skill_train', 'rebirth_branch', 'npc_buy', 'affix_reroll', 'affix_choose', 'craft', 'ascend', 'ascend_switch', 'companion_gift')),
  request_hash  TEXT NOT NULL,
  result_json   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (account_id, operation_id)
);
INSERT INTO service_operations_v9 SELECT account_id, operation_id, kind, request_hash, result_json, created_at FROM service_operations;
DROP TABLE service_operations;
ALTER TABLE service_operations_v9 RENAME TO service_operations;
