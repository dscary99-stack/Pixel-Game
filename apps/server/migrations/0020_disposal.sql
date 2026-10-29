-- Selling / salvaging gear, releasing companions, protect flags and nicknames (chapter 09, chapter 10).
-- asset_disposals: one row per request (the anchor); token marks the request that won the row so the
-- rest of its batch applies only under it. disposed_assets keeps a snapshot of every piece or
-- companion that left, for support and recovery; the live rows are deleted.
CREATE TABLE asset_disposals (
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  operation_id  TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('gear_sell', 'gear_salvage', 'companion_release')),
  request_hash  TEXT NOT NULL,
  token         TEXT NOT NULL,
  result_json   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (account_id, operation_id)
);

CREATE TABLE disposed_assets (
  account_id     TEXT NOT NULL REFERENCES accounts(id),
  operation_id   TEXT NOT NULL,
  asset_kind     TEXT NOT NULL CHECK (asset_kind IN ('equipment', 'companion')),
  asset_id       TEXT NOT NULL,
  snapshot_json  TEXT NOT NULL,
  disposed_at    TEXT NOT NULL,
  PRIMARY KEY (asset_kind, asset_id)
);

ALTER TABLE equipment_instances ADD COLUMN protected INTEGER NOT NULL DEFAULT 0 CHECK (protected IN (0, 1));
ALTER TABLE monster_instances ADD COLUMN protected INTEGER NOT NULL DEFAULT 0 CHECK (protected IN (0, 1));
ALTER TABLE monster_instances ADD COLUMN nickname TEXT;
