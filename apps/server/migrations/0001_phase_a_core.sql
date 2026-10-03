-- Phase A economy/progression contracts for D1 (chapter 11 §2–§4, chapter 12 §2).
-- PROVISIONAL (P11): candidate schema, not yet applied to a real D1 database.
-- Money is integer minor units. Probabilities never live here.

CREATE TABLE accounts (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL
);

CREATE TABLE wallets (
  account_id  TEXT PRIMARY KEY REFERENCES accounts(id),
  coins       INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  version     INTEGER NOT NULL DEFAULT 1
);

-- Append-only item ledger. Every grant/consume line is keyed by (operation_id, line_no),
-- so a retried operation is a no-op instead of a second grant.
CREATE TABLE item_ledger (
  operation_id  TEXT NOT NULL,
  line_no       INTEGER NOT NULL,
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  item_id       TEXT NOT NULL,
  delta         INTEGER NOT NULL CHECK (delta <> 0),
  reason        TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (operation_id, line_no)
);
CREATE INDEX item_ledger_account ON item_ledger (account_id, item_id);

CREATE VIEW inventory_balances AS
  SELECT account_id, item_id, SUM(delta) AS quantity
  FROM item_ledger
  GROUP BY account_id, item_id;

-- Companion instances. No storage cap column on purpose (C04: no gameplay cap on the companion box).
CREATE TABLE monster_instances (
  id                        TEXT PRIMARY KEY,
  species_id                TEXT NOT NULL,
  owner_id                  TEXT NOT NULL REFERENCES accounts(id),
  current_level             INTEGER NOT NULL CHECK (current_level BETWEEN 1 AND 200),
  xp                        INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  rebirth_stage             INTEGER NOT NULL DEFAULT 0 CHECK (rebirth_stage >= 0),
  element                   TEXT NOT NULL,
  primary_stats_json        TEXT NOT NULL,
  growth_history_version    INTEGER NOT NULL DEFAULT 1,
  trained_skill_levels_json TEXT NOT NULL DEFAULT '{}',
  bond                      INTEGER NOT NULL DEFAULT 0 CHECK (bond BETWEEN 0 AND 1000),
  origin_json               TEXT NOT NULL,
  ownership_version         INTEGER NOT NULL DEFAULT 1,
  lock_state                TEXT NOT NULL DEFAULT 'free' CHECK (lock_state IN ('free', 'in_battle', 'in_escrow')),
  created_operation_id      TEXT NOT NULL UNIQUE
);
CREATE INDEX monster_instances_owner ON monster_instances (owner_id);

-- One receipt per (entitlement, recipient). Same id with a different payload is refused.
CREATE TABLE reward_receipts (
  entitlement_id  TEXT NOT NULL,
  recipient_id    TEXT NOT NULL REFERENCES accounts(id),
  payload_hash    TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('granted')),
  committed_at    TEXT NOT NULL,
  PRIMARY KEY (entitlement_id, recipient_id)
);

-- Loadout / combat bag reservation for a battle (chapter 11 §3 steps 2, 3, 8).
CREATE TABLE battle_reservations (
  reservation_id  TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  battle_id       TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL CHECK (status IN ('reserved', 'active', 'settled', 'released')),
  loadout_json    TEXT NOT NULL,
  bag_json        TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
-- At most one unfinished battle per account.
CREATE UNIQUE INDEX battle_reservations_one_open
  ON battle_reservations (account_id) WHERE status IN ('reserved', 'active');
