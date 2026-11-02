-- NPC Orders (chapter 09): one row per fill. The quest week is part of the row, and the weekly
-- limit is a guard on the insert, so racing fills never pass the limit. token: the request that won
-- the row; the rest of its batch applies only under it.
CREATE TABLE npc_order_fills (
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  operation_id  TEXT NOT NULL,
  period_id     TEXT NOT NULL,
  order_id      TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  token         TEXT NOT NULL,
  result_json   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (account_id, operation_id)
);
CREATE INDEX npc_order_fills_week ON npc_order_fills (account_id, period_id, order_id);
