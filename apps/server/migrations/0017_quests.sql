-- Daily / Weekly quests (chapter 09, P13).
-- quest_activity: what the server recorded (kills and captures when their reward is granted, crafts),
-- one row per source id, so a retried grant or craft counts once. Quest progress is summed from it
-- for the period's time window, so nothing has to be accepted first.
CREATE TABLE quest_activity (
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  activity_id  TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('kill', 'capture', 'craft')),
  subject      TEXT NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  at           TEXT NOT NULL,
  PRIMARY KEY (account_id, activity_id)
);
CREATE INDEX quest_activity_window ON quest_activity (account_id, kind, at);

-- The board a character got for a period, rolled once on first look.
CREATE TABLE quest_boards (
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  period_id   TEXT NOT NULL,
  board_json  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (account_id, period_id)
);

-- One row per claimed reward; the period is part of the key, so a reward is claimed at most once.
-- token: the request that won the row; the rest of its batch only applies under that token.
CREATE TABLE quest_claims (
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  period_id    TEXT NOT NULL,
  slot         TEXT NOT NULL,
  token        TEXT NOT NULL,
  reward_json  TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (account_id, period_id, slot)
);
