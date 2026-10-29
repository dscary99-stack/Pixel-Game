-- Deleting a character (Nut 2026-10-18): everything it had is lost, except the account vault.
-- PROVISIONAL (P11): candidate schema. The play account stays (its ledgers, companions and gear are
-- left behind with no way in); the place is emptied, and the next character there gets a new play
-- account (playAccountId generation = deletions of that place so far).
CREATE TABLE deleted_characters (
  account_id    TEXT PRIMARY KEY REFERENCES accounts(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  slot          INTEGER NOT NULL,
  operation_id  TEXT NOT NULL,
  name          TEXT NOT NULL,
  deleted_at    TEXT NOT NULL,
  UNIQUE (user_id, operation_id)
);
CREATE INDEX deleted_characters_place ON deleted_characters (user_id, slot);
