-- Crafting (chapter 05 §6, chapter 09): mastery per character per profession, and the craft service
-- kind (service_operations rebuilt, same rows).
CREATE TABLE craft_mastery (
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  profession  TEXT NOT NULL CHECK (profession IN ('weaponsmith', 'armorsmith', 'jeweler', 'alchemist', 'tamer', 'tailor')),
  mastery     INTEGER NOT NULL CHECK (mastery BETWEEN 0 AND 1000),
  PRIMARY KEY (account_id, profession)
);

CREATE TABLE service_operations_v7 (
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  operation_id  TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('npc_sell', 'sigil_install', 'sigil_remove', 'companion_rebirth', 'skill_train', 'rebirth_branch', 'npc_buy', 'affix_reroll', 'affix_choose', 'craft')),
  request_hash  TEXT NOT NULL,
  result_json   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (account_id, operation_id)
);
INSERT INTO service_operations_v7 SELECT account_id, operation_id, kind, request_hash, result_json, created_at FROM service_operations;
DROP TABLE service_operations;
ALTER TABLE service_operations_v7 RENAME TO service_operations;
