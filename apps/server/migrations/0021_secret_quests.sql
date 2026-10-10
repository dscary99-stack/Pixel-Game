-- Secret quests (Nut 2026-10-05: no ending; element + race + personal quests after the Lv200 awakening).
-- PROVISIONAL (P11): candidate schema, not yet applied to a real D1 database.
--
-- One row per character holding its whole rolled set. The set is written in the character's create
-- batch (or, for characters made before this table, on first read), always insert-if-absent on the
-- character id, so a replayed or raced write never rerolls it. generator_version says which roll
-- produced quests_json. revealed_at NULL = locked: nothing about the set goes to the client.
CREATE TABLE character_secret_quests (
  character_id       TEXT PRIMARY KEY REFERENCES characters(id),
  account_id         TEXT NOT NULL REFERENCES accounts(id),
  generator_version  INTEGER NOT NULL CHECK (generator_version >= 1),
  quests_json        TEXT NOT NULL,
  revealed_at        TEXT,
  created_at         TEXT NOT NULL
);
