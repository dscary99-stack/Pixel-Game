-- Mailbox (Nut 2026-10-09). PROVISIONAL (P11/P27): candidate schema, not yet applied to a real D1 database.
--
-- One row per letter, per character (account_id). payload_json holds items, coins and the pieces /
-- companions that are made only when the letter is claimed, so nothing in an unclaimed letter exists
-- in equipment_instances or monster_instances yet (and a companion there does not count in the box).
-- claim_op names the claim that took it; mail_operations is the anchor of every claim request.

CREATE TABLE mail (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  source        TEXT NOT NULL CHECK (source IN ('system', 'secret_reward', 'market_sale')),
  title_th      TEXT NOT NULL,
  body_th       TEXT NOT NULL DEFAULT '',
  payload_json  TEXT NOT NULL,
  companions    INTEGER NOT NULL DEFAULT 0 CHECK (companions >= 0),
  has_assets    INTEGER NOT NULL DEFAULT 0 CHECK (has_assets IN (0, 1)),
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  claimed_at    TEXT,
  claim_op      TEXT
);
CREATE INDEX mail_account ON mail (account_id, created_at);

CREATE TABLE mail_operations (
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  operation_id  TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('mail_claim')),
  request_hash  TEXT NOT NULL,
  token         TEXT NOT NULL,
  result_json   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (account_id, operation_id)
);
