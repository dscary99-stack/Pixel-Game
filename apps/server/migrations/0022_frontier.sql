-- Weekly battle tower (chapter 07 §4 "tower"; Nut 2026-10-06: floor by floor, one entry a week, a boss
-- every 10 floors, 100 floors, rare boss items, capture inside). PROVISIONAL (P11): candidate schema,
-- not yet applied to a real D1 database.
--
-- frontier_runs: one row per character, tower and quest week (P13 week, reset Monday 21:00 UTC). The row
-- IS the week's entry token: UNIQUE (character_id, frontier_id, week_id) lets exactly one entry win, and
-- operation_id says which request made it (a retry of that request gets the same run back).
--   floor        next floor to fight (floors + 1 after the summit)
--   best_floor   highest floor cleared in this run = the character's record for the week (leaderboards later)
--   battle_id    the floor fight in progress; NULL between floors
--   attempt      bumped only when a floor fight was voided before it started (reservation released)
--   vitals_json  HP/MP carried between floors ({ player, companions }); NULL = full
--   team_json    the team that entered (sorted companion ids); floors refuse another team
CREATE TABLE frontier_runs (
  run_id        TEXT PRIMARY KEY,
  character_id  TEXT NOT NULL REFERENCES characters(id),
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  frontier_id   TEXT NOT NULL,
  week_id       TEXT NOT NULL,
  operation_id  TEXT NOT NULL,
  team_json     TEXT NOT NULL,
  floor         INTEGER NOT NULL CHECK (floor >= 1),
  best_floor    INTEGER NOT NULL DEFAULT 0 CHECK (best_floor >= 0),
  status        TEXT NOT NULL CHECK (status IN ('open', 'ended')),
  end_reason    TEXT CHECK (end_reason IN ('defeat', 'summit')),
  inside        INTEGER NOT NULL DEFAULT 1 CHECK (inside IN (0, 1)),
  battle_id     TEXT,
  attempt       INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  vitals_json   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (character_id, frontier_id, week_id)
);
CREATE INDEX frontier_runs_week_best ON frontier_runs (frontier_id, week_id, best_floor);

-- One row per settled floor fight: the anchor that makes settlement happen once. token: the request
-- whose batch wrote it (a racing settle sees another token and knows it changed nothing).
CREATE TABLE frontier_floor_results (
  run_id      TEXT NOT NULL REFERENCES frontier_runs(run_id),
  floor       INTEGER NOT NULL,
  battle_id   TEXT NOT NULL,
  outcome     TEXT NOT NULL,
  token       TEXT NOT NULL,
  settled_at  TEXT NOT NULL,
  PRIMARY KEY (run_id, floor)
);

-- First time a character cleared each boss floor (kept across weeks; first-clear rewards later).
CREATE TABLE frontier_first_clears (
  character_id  TEXT NOT NULL REFERENCES characters(id),
  frontier_id   TEXT NOT NULL,
  floor         INTEGER NOT NULL,
  run_id        TEXT NOT NULL,
  cleared_at    TEXT NOT NULL,
  PRIMARY KEY (character_id, frontier_id, floor)
);
