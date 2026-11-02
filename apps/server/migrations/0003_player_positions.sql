-- Canonical character location for the walking slice (chapter 11 §1, chapter 13 §1 B).
-- PROVISIONAL (P11): candidate schema, not yet applied to a real D1 database.
--
-- The Map Channel Durable Object holds live positions; this row is what survives a restart and
-- decides where a reconnecting player may appear. `generation` goes up on every join: only the
-- channel holding the current generation may save, so an older connection can never overwrite
-- a newer one (P14: one controlling session per account).
CREATE TABLE player_positions (
  account_id  TEXT PRIMARY KEY REFERENCES accounts(id),
  map_id      TEXT NOT NULL,
  channel     INTEGER NOT NULL CHECK (channel >= 1),
  x           INTEGER NOT NULL CHECK (x >= 0),
  y           INTEGER NOT NULL CHECK (y >= 0),
  generation  INTEGER NOT NULL CHECK (generation >= 1),
  updated_at  TEXT NOT NULL
);
