-- Secret quest hand-ins and reward claims (secret-progress-store.ts). PROVISIONAL (P11): candidate schema.
--
-- secret_quest_deliveries: one row per hand-in request (operation id); its item debit and progress
-- apply only under the token that won the row. secret_quest_claims: one row per (character, quest),
-- so a quest's rewards are granted once; every grant in that batch applies only under its token.
-- character_secret_rewards: what the character owns from secret quests (titles and fashion live only
-- here; a companion or a piece of gear also has its own row, named by `ref`).
CREATE TABLE secret_quest_deliveries (
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  operation_id  TEXT NOT NULL,
  character_id  TEXT NOT NULL REFERENCES characters(id),
  quest_id      TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  token         TEXT NOT NULL,
  result_json   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (account_id, operation_id)
);

CREATE TABLE secret_quest_claims (
  character_id  TEXT NOT NULL REFERENCES characters(id),
  quest_id      TEXT NOT NULL,
  token         TEXT NOT NULL,
  result_json   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (character_id, quest_id)
);

CREATE TABLE character_secret_rewards (
  character_id  TEXT NOT NULL REFERENCES characters(id),
  quest_id      TEXT NOT NULL,
  reward_no     INTEGER NOT NULL CHECK (reward_no >= 0),
  kind          TEXT NOT NULL CHECK (kind IN ('title', 'fashion', 'companion', 'gear')),
  reward_id     TEXT NOT NULL,
  variant_id    TEXT NOT NULL,
  ref           TEXT,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (character_id, quest_id, reward_no)
);
