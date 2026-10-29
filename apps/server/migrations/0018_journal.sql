-- Collection / Journal (chapter 09): species met in fights (with element), maps entered, and the
-- cosmetic title a character shows. Defeats and personal captures come from quest_activity.
CREATE TABLE journal_seen (
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  species_id  TEXT NOT NULL,
  element     TEXT NOT NULL,
  first_at    TEXT NOT NULL,
  PRIMARY KEY (account_id, species_id, element)
);

-- Elements captured personally, written with the capture's reward, so the record stays after the
-- companion leaves (sold or traded later).
CREATE TABLE journal_caught (
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  species_id  TEXT NOT NULL,
  element     TEXT NOT NULL,
  first_at    TEXT NOT NULL,
  PRIMARY KEY (account_id, species_id, element)
);

CREATE TABLE map_discoveries (
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  map_id      TEXT NOT NULL,
  first_at    TEXT NOT NULL,
  PRIMARY KEY (account_id, map_id)
);

ALTER TABLE characters ADD COLUMN title_id TEXT;
