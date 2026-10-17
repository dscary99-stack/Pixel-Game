-- Equipment instances and what each character wears (chapter 05 §1, C21, C23; Phase D).
-- PROVISIONAL (P11): candidate schema, not yet applied to a real D1 database.
--
-- Every piece is its own instance (it can carry refining, affixes and Sigils later). Drops and
-- grants are keyed by created_operation_id, so a retried grant never makes a second piece.
CREATE TABLE equipment_instances (
  id                    TEXT PRIMARY KEY,
  definition_id         TEXT NOT NULL,
  owner_id              TEXT NOT NULL REFERENCES accounts(id),
  refine_level          INTEGER NOT NULL DEFAULT 0 CHECK (refine_level BETWEEN 0 AND 10),
  affixes_json          TEXT NOT NULL DEFAULT '[]',
  sigil_sockets_json    TEXT NOT NULL DEFAULT '[]',
  lock_state            TEXT NOT NULL DEFAULT 'free' CHECK (lock_state IN ('free', 'in_battle', 'in_escrow')),
  lock_ref              TEXT,
  created_operation_id  TEXT NOT NULL UNIQUE,
  created_at            TEXT NOT NULL
);
CREATE INDEX equipment_instances_owner ON equipment_instances (owner_id);
CREATE INDEX equipment_instances_lock_ref ON equipment_instances (lock_ref) WHERE lock_ref IS NOT NULL;

-- One piece per slot, and a piece is worn in at most one slot.
CREATE TABLE character_equipment (
  character_id           TEXT NOT NULL REFERENCES characters(id),
  slot                   TEXT NOT NULL CHECK (slot IN ('HEAD_TOP', 'HEAD_MID', 'HEAD_LOW', 'ARMS', 'ARMOR', 'FEET',
                                                       'MAIN_HAND', 'OFF_HAND', 'ACCESSORY_1', 'ACCESSORY_2', 'BACK', 'AURA')),
  equipment_instance_id  TEXT NOT NULL UNIQUE REFERENCES equipment_instances(id),
  PRIMARY KEY (character_id, slot)
);

-- Marks which equip request won a version bump, like team_hash does for team changes.
ALTER TABLE characters ADD COLUMN gear_hash TEXT;
