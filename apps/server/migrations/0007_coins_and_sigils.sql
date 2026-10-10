-- Coins and town services: NPC selling, Sigil install and removal (chapter 05 §4, chapter 06; Phase D).
-- PROVISIONAL (P11/P12): candidate schema, not yet applied to a real D1 database.
--
-- Coins are a ledger like items: every change is a keyed row, the balance is the sum, so a retried
-- operation can never pay or charge twice. "เหรียญ" is a placeholder currency name (chapter 06).
CREATE TABLE coin_ledger (
  operation_id  TEXT NOT NULL,
  line_no       INTEGER NOT NULL,
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  delta         INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (operation_id, line_no)
);
CREATE INDEX coin_ledger_account ON coin_ledger (account_id);

-- One row per accepted service request. It is the anchor the other writes of the same batch check
-- (with this request's hash), and what a retry with the same operation id finds.
CREATE TABLE service_operations (
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  operation_id  TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('npc_sell', 'sigil_install', 'sigil_remove')),
  request_hash  TEXT NOT NULL,
  result_json   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (account_id, operation_id)
);
