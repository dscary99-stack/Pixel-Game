-- Party (chapter 08 "Party", P02). PROVISIONAL (P11): candidate schema.
-- One party per account at a time; at most partyMaxMembers per party, enforced in the INSERT.
CREATE TABLE parties (
  id          TEXT PRIMARY KEY,
  created_by  TEXT NOT NULL REFERENCES accounts(id),
  created_at  TEXT NOT NULL
);

CREATE TABLE party_members (
  account_id  TEXT PRIMARY KEY REFERENCES accounts(id),
  party_id    TEXT NOT NULL REFERENCES parties(id),
  joined_at   TEXT NOT NULL
);
CREATE INDEX party_members_party ON party_members (party_id);

-- "Started a fight recently" (the party activity window) reads claims by account and time.
CREATE INDEX encounter_claims_recent ON encounter_claims (account_id, created_at);
