-- Job levels and skill trees (P29, job.ts, skill-tree.ts; Nut 2026-10-09): job EXP per class tier and
-- the skill levels learned on the trees. Existing characters keep their base EXP as Class1 job EXP
-- (the job track reads past its cap as the cap), so they keep the points they would have earned.
ALTER TABLE characters ADD COLUMN job1_xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN job2_xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN skills_json TEXT NOT NULL DEFAULT '{}';
UPDATE characters SET job1_xp = xp;
