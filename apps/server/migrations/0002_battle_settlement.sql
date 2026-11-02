-- Battle reservation lifecycle and settlement (chapter 11 §3 steps 2, 3, 7, 8).
-- PROVISIONAL (P11): candidate schema, not yet applied to a real D1 database.
--
-- reserved  --activate-->  active  --settle-->  settled
--    \--release (reconciler, only if the Battle DO confirms the fight never started)--> released
--
-- Reserved bag items leave the inventory as ledger lines `reserve:<reservationId>` (negative).
-- Settlement returns only the unused part as `settle:<reservationId>`; release returns all of it
-- as `release:<reservationId>`. Each line is keyed (operation_id, line_no), so retries are no-ops.

-- Hash of the reserve request; ledger and lock writes only apply when it matches this request.
ALTER TABLE battle_reservations ADD COLUMN request_hash TEXT NOT NULL DEFAULT '';
-- Hash of the settlement payload; set once by the first settle. A different payload is refused.
ALTER TABLE battle_reservations ADD COLUMN settlement_hash TEXT;
ALTER TABLE battle_reservations ADD COLUMN outcome TEXT CHECK (outcome IN ('victory', 'defeat', 'fled'));
-- Final HP/MP of the allies. There is no character table yet to write them to (Phase D).
ALTER TABLE battle_reservations ADD COLUMN result_json TEXT;

-- Which reservation holds a companion while lock_state = 'in_battle'.
ALTER TABLE monster_instances ADD COLUMN lock_ref TEXT;
CREATE INDEX monster_instances_lock_ref ON monster_instances (lock_ref) WHERE lock_ref IS NOT NULL;

-- Reconciler scan: unfinished reservations by age.
CREATE INDEX battle_reservations_open_age ON battle_reservations (status, created_at) WHERE status = 'reserved';
