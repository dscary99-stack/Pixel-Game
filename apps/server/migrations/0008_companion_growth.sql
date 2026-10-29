-- Companion growth (chapter 04 §4, P05): the server picks a growth seed once per companion and its
-- stats follow from (seed, archetype, level, Rebirth stage). Companions made before this get their
-- own id as seed (server-made, never chosen by a client) and move to growth version 2.
ALTER TABLE monster_instances ADD COLUMN growth_seed TEXT;
UPDATE monster_instances SET growth_seed = id WHERE growth_seed IS NULL;
UPDATE monster_instances SET growth_history_version = 2 WHERE growth_history_version < 2;
