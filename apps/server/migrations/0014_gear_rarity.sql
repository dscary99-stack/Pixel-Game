-- Gear rarity (chapter 05 §2, P09). Affixes already live in equipment_instances.affixes_json.
-- Both are rolled once by the server when a piece is made; a retried grant keeps the first row.
ALTER TABLE equipment_instances ADD COLUMN rarity TEXT NOT NULL DEFAULT 'COMMON'
  CHECK (rarity IN ('COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'));
