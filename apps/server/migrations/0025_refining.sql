-- Refining / ตีบวก (Nut's REFINEMENT_DESIGN v2.1; refine.ts, refine-store.ts).
--
-- equipment_instances.version: bumped by every refine attempt. A request names the version it saw,
-- so of two racing attempts on one piece only the first lands.
ALTER TABLE equipment_instances ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);

-- One row per accepted attempt: the receipt (roll, outcome, what was paid) a retry gets back. token
-- marks the request that won the row, so the rest of its batch applies only under it. A destroyed
-- piece's live row is deleted and its snapshot goes to disposed_assets (operation_id = this attempt)
-- as the tombstone, so it can never be worn, traded or crafted with again.
CREATE TABLE refine_operations (
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  operation_id  TEXT NOT NULL,
  equipment_id  TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  token         TEXT NOT NULL,
  outcome       TEXT NOT NULL CHECK (outcome IN ('success', 'kept', 'destroyed')),
  result_json   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (account_id, operation_id)
);
CREATE INDEX refine_operations_equipment ON refine_operations (equipment_id);
