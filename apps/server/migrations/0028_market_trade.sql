-- World Market and direct trade (Nut 2026-10-07; chapter 11 §4: escrow first).
-- PROVISIONAL (P11/P23/P24): candidate schema, not yet applied to a real D1 database.
--
-- A listed or offered thing stays in its owner's rows but is held: gear and companions get
-- lock_state 'in_escrow' with lock_ref = the listing / offer id; items and coins are taken out of the
-- owner's ledger with a keyed line and come back (or go to the other player) with another keyed line.
-- exchange_operations is the anchor of every request (like asset_disposals): it is inserted only when
-- all guards hold, and the rest of the batch applies only under its token.

CREATE TABLE exchange_operations (
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  operation_id  TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('market_list', 'market_cancel', 'market_buy', 'trade_offer', 'trade_accept', 'trade_decline', 'trade_cancel')),
  request_hash  TEXT NOT NULL,
  token         TEXT NOT NULL,
  result_json   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (account_id, operation_id)
);

CREATE TABLE market_listings (
  id             TEXT PRIMARY KEY,
  seller_id      TEXT NOT NULL REFERENCES accounts(id),
  kind           TEXT NOT NULL CHECK (kind IN ('item', 'equipment', 'companion')),
  -- item: the item id; equipment / companion: the instance id.
  asset_id       TEXT NOT NULL,
  quantity       INTEGER NOT NULL CHECK (quantity >= 1),
  price          INTEGER NOT NULL CHECK (price >= 1),
  fee_paid       INTEGER NOT NULL CHECK (fee_paid >= 0),
  -- Tax rate frozen at listing time, so a later rule change does not change a sale already offered.
  tax_bps        INTEGER NOT NULL CHECK (tax_bps >= 0),
  -- Thai name for search, and the frozen snapshot the buyer is shown.
  name_th        TEXT NOT NULL,
  snapshot_json  TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('active', 'sold', 'cancelled')),
  buyer_id       TEXT REFERENCES accounts(id),
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  closed_at      TEXT
);
CREATE INDEX market_listings_browse ON market_listings (status, expires_at, created_at);
CREATE INDEX market_listings_seller ON market_listings (seller_id, status);
-- One open listing per piece or companion (items may have several stacks listed).
CREATE UNIQUE INDEX market_listings_one_per_instance ON market_listings (kind, asset_id) WHERE status = 'active' AND kind <> 'item';

CREATE TABLE trade_offers (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('item', 'companion')),
  from_id      TEXT NOT NULL REFERENCES accounts(id),
  to_id        TEXT NOT NULL REFERENCES accounts(id),
  -- The request sides ({items, equipmentIds, companionIds, coins}) and their display snapshots.
  give_json    TEXT NOT NULL,
  want_json    TEXT NOT NULL,
  view_json    TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('open', 'accepted', 'declined', 'cancelled')),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  closed_at    TEXT,
  CHECK (from_id <> to_id)
);
CREATE INDEX trade_offers_from ON trade_offers (from_id, status);
CREATE INDEX trade_offers_to ON trade_offers (to_id, status);

-- Per-piece / per-companion ห้ามขาย and ห้ามเทรด (definitions can also carry them).
ALTER TABLE equipment_instances ADD COLUMN no_sell INTEGER NOT NULL DEFAULT 0 CHECK (no_sell IN (0, 1));
ALTER TABLE equipment_instances ADD COLUMN no_trade INTEGER NOT NULL DEFAULT 0 CHECK (no_trade IN (0, 1));
ALTER TABLE monster_instances ADD COLUMN no_sell INTEGER NOT NULL DEFAULT 0 CHECK (no_sell IN (0, 1));
ALTER TABLE monster_instances ADD COLUMN no_trade INTEGER NOT NULL DEFAULT 0 CHECK (no_trade IN (0, 1));

-- The code another player types to trade with this character.
ALTER TABLE characters ADD COLUMN trade_code TEXT;
CREATE UNIQUE INDEX characters_trade_code ON characters (trade_code) WHERE trade_code IS NOT NULL;
