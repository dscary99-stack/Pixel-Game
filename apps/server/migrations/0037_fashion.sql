-- Worn fashion แฟชั่น (fashion.ts, STATUS A151): layer → { rewardId, effect, color } for the pieces the
-- character wears from its secret-quest rewards. NULL = nothing worn.
ALTER TABLE characters ADD COLUMN fashion_json TEXT;
