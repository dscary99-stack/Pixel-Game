-- Character looks (Nut 2026-11-01; shared appearance.ts, P38): hair, face and colours picked at
-- creation, as JSON. A look only, never read for numbers. NULL (characters made before this) = the
-- default look.
ALTER TABLE characters ADD COLUMN appearance_json TEXT;
