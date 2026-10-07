-- Party boss fights (Nut 2026-10-07): one battle, one reservation per member. A battle id was unique
-- per reservation; now it is unique per (battle, account). SQLite cannot drop a constraint, so the
-- table is rebuilt (nothing references it by foreign key). Same columns, same indexes.
CREATE TABLE battle_reservations_new (
  reservation_id  TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  battle_id       TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('reserved', 'active', 'settled', 'released')),
  loadout_json    TEXT NOT NULL,
  bag_json        TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  request_hash    TEXT NOT NULL DEFAULT '',
  settlement_hash TEXT,
  outcome         TEXT CHECK (outcome IN ('victory', 'defeat', 'fled')),
  result_json     TEXT,
  UNIQUE (battle_id, account_id)
);
INSERT INTO battle_reservations_new
  (reservation_id, account_id, battle_id, status, loadout_json, bag_json, created_at, updated_at, request_hash, settlement_hash, outcome, result_json)
  SELECT reservation_id, account_id, battle_id, status, loadout_json, bag_json, created_at, updated_at, request_hash, settlement_hash, outcome, result_json
  FROM battle_reservations;
DROP TABLE battle_reservations;
ALTER TABLE battle_reservations_new RENAME TO battle_reservations;
CREATE UNIQUE INDEX battle_reservations_one_open ON battle_reservations (account_id) WHERE status IN ('reserved', 'active');
CREATE INDEX battle_reservations_open_age ON battle_reservations (status, created_at) WHERE status = 'reserved';
