-- Class2 (class-change.ts, P16/P28): the branch a character took after winning the trial, and the
-- trial operation that claimed it (a retried claim finds its own operation and answers the same).
ALTER TABLE characters ADD COLUMN class2_id TEXT;
ALTER TABLE characters ADD COLUMN class2_operation_id TEXT;

-- One row per trial fight: the branch named at the start, the fight, and whether it was claimed.
CREATE TABLE class_trials (
  character_id    TEXT NOT NULL REFERENCES characters(id),
  operation_id    TEXT NOT NULL,
  account_id      TEXT NOT NULL,
  branch_id       TEXT NOT NULL,
  battle_id       TEXT NOT NULL UNIQUE,
  reservation_id  TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('started', 'claimed')),
  created_at      TEXT NOT NULL,
  PRIMARY KEY (character_id, operation_id)
);
CREATE INDEX class_trials_by_character ON class_trials (character_id, created_at);
