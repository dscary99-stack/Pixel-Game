-- Player characters and their team (Phase D first slice; chapter 02, chapter 03 §3–§4, C04).
-- PROVISIONAL (P11): candidate schema, not yet applied to a real D1 database.
--
-- One character per account until O10 (characters per account) is decided; the id is separate
-- from the account so more characters can be added later without changing references.
CREATE TABLE characters (
  id                    TEXT PRIMARY KEY,
  account_id            TEXT NOT NULL UNIQUE REFERENCES accounts(id),
  name                  TEXT NOT NULL,
  class_id              TEXT NOT NULL,
  race_id               TEXT NOT NULL,
  element               TEXT NOT NULL,
  level                 INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 200),
  xp                    INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  primary_stats_json    TEXT NOT NULL,
  -- Current HP/MP carry over between fights (chapter 03 §3). NULL = full.
  hp                    INTEGER CHECK (hp IS NULL OR hp >= 0),
  mp                    INTEGER CHECK (mp IS NULL OR mp >= 0),
  -- Optimistic concurrency for team and stat changes; team_hash marks which write won.
  version               INTEGER NOT NULL DEFAULT 1,
  team_hash             TEXT,
  created_operation_id  TEXT NOT NULL UNIQUE,
  created_at            TEXT NOT NULL
);

-- The fighting team: at most 5 companions (C04), no species twice even with another element.
CREATE TABLE character_team (
  character_id         TEXT NOT NULL REFERENCES characters(id),
  position             INTEGER NOT NULL CHECK (position BETWEEN 0 AND 4),
  monster_instance_id  TEXT NOT NULL UNIQUE REFERENCES monster_instances(id),
  species_id           TEXT NOT NULL,
  row                  TEXT NOT NULL CHECK (row IN ('front', 'back')),
  slot                 INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 4),
  PRIMARY KEY (character_id, position),
  UNIQUE (character_id, species_id),
  UNIQUE (character_id, row, slot)
);

-- Companion HP/MP also carry over; NULL = full. A knocked-out companion stays at 0 until rest.
ALTER TABLE monster_instances ADD COLUMN hp INTEGER CHECK (hp IS NULL OR hp >= 0);
ALTER TABLE monster_instances ADD COLUMN mp INTEGER CHECK (mp IS NULL OR mp >= 0);
