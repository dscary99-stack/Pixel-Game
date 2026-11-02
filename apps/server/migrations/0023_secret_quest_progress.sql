-- Secret quest progress (secret-progress.ts). PROVISIONAL (P11): candidate schema.
--
-- Counted only for a revealed set, from won fights whose every condition held. A fight credits a
-- character at most once: secret_quest_credits holds one row per (character, battle), and the
-- progress writes of that settlement apply only under the token that won the row. Progress never
-- goes past the quest's count; completed_at is set once, when it first reaches it.
CREATE TABLE secret_quest_credits (
  character_id  TEXT NOT NULL REFERENCES characters(id),
  source_id     TEXT NOT NULL,
  token         TEXT NOT NULL,
  at            TEXT NOT NULL,
  PRIMARY KEY (character_id, source_id)
);

CREATE TABLE secret_quest_progress (
  character_id  TEXT NOT NULL REFERENCES characters(id),
  quest_id      TEXT NOT NULL,
  progress      INTEGER NOT NULL CHECK (progress >= 0),
  completed_at  TEXT,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (character_id, quest_id)
);
