-- Account vault shared by the characters of one login (Nut 2026-10-08). PROVISIONAL (P11/P25):
-- candidate schema, not yet applied to a real D1 database.
--
-- vault_id is 'user:<users.id>' for a login's characters, or 'solo:<account id>' for a dev account that
-- belongs to no login. Items and coins in the vault are ledgers like the character ledgers; a piece in
-- the vault stays in equipment_instances (lock_state 'in_escrow', lock_ref 'vault') with a row here, and
-- whoever takes it out becomes its owner. vault_operations is the anchor of every request.

CREATE TABLE vault_operations (
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  operation_id  TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('vault_deposit', 'vault_withdraw')),
  request_hash  TEXT NOT NULL,
  token         TEXT NOT NULL,
  result_json   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (account_id, operation_id)
);

CREATE TABLE vault_item_ledger (
  operation_id  TEXT NOT NULL,
  line_no       INTEGER NOT NULL,
  vault_id      TEXT NOT NULL,
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  item_id       TEXT NOT NULL,
  delta         INTEGER NOT NULL CHECK (delta <> 0),
  created_at    TEXT NOT NULL,
  PRIMARY KEY (operation_id, line_no)
);
CREATE INDEX vault_item_ledger_vault ON vault_item_ledger (vault_id, item_id);

CREATE TABLE vault_coin_ledger (
  operation_id  TEXT NOT NULL PRIMARY KEY,
  vault_id      TEXT NOT NULL,
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  delta         INTEGER NOT NULL CHECK (delta <> 0),
  created_at    TEXT NOT NULL
);
CREATE INDEX vault_coin_ledger_vault ON vault_coin_ledger (vault_id);

CREATE TABLE vault_equipment (
  equipment_id  TEXT PRIMARY KEY REFERENCES equipment_instances(id),
  vault_id      TEXT NOT NULL,
  deposited_by  TEXT NOT NULL REFERENCES accounts(id),
  deposited_at  TEXT NOT NULL
);
CREATE INDEX vault_equipment_vault ON vault_equipment (vault_id);

-- ห้ามฝากคลัง on one piece (definitions can carry it too).
ALTER TABLE equipment_instances ADD COLUMN no_store INTEGER NOT NULL DEFAULT 0 CHECK (no_store IN (0, 1));
