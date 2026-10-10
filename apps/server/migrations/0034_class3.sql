-- Class3 (class-change.ts, P16/P28): the Class3 a character took after winning the Lv120 trial, the
-- operation that claimed it, and the Class3 job EXP (P29) it earns from then on.
ALTER TABLE characters ADD COLUMN class3_id TEXT;
ALTER TABLE characters ADD COLUMN class3_operation_id TEXT;
ALTER TABLE characters ADD COLUMN job3_xp INTEGER NOT NULL DEFAULT 0;
