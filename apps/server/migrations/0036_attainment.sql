-- The attainment quest เควสบรรลุ (attainment.ts, STATUS A150): the report that opened a character's
-- secret quest set, so a retry of the same report replays instead of being refused.
ALTER TABLE character_secret_quests ADD COLUMN reveal_operation_id TEXT;
