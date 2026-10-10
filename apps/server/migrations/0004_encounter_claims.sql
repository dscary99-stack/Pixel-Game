-- Private encounters (O05 decided 2026-10-03; chapter 07 §3, chapter 11 §3 step 1).
-- PROVISIONAL (P11): candidate schema, not yet applied to a real D1 database.
--
-- One row per (player, pack instance): the fight that player gets for that pack. Engaging again
-- (retry, reload, double tap) returns the same battle instead of a second fight, and a pack the
-- player already fought stays hidden for them until the next respawn cycle rolls a new instance.
CREATE TABLE encounter_claims (
  account_id        TEXT NOT NULL REFERENCES accounts(id),
  pack_instance_id  TEXT NOT NULL,
  battle_id         TEXT NOT NULL UNIQUE,
  roster_json       TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  PRIMARY KEY (account_id, pack_instance_id)
);
