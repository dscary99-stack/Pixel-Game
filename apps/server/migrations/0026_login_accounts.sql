-- Login accounts (O10/O11, Nut 2026-10-07). PROVISIONAL (P11): candidate schema.
-- A user signs in with Google, Facebook or a local ID and owns up to 10 characters; each character
-- is its own play account in `accounts`, so every existing table keeps keying on account_id.
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL
);

-- One row per way of signing in. subject = Google `sub`, Facebook user id, or the local ID in lower case.
-- Local IDs carry a PBKDF2-SHA256 hash; the failed-attempt window locks password sign-in for a while.
CREATE TABLE user_identities (
  provider        TEXT NOT NULL CHECK (provider IN ('google', 'facebook', 'local')),
  subject         TEXT NOT NULL,
  user_id         TEXT NOT NULL REFERENCES users(id),
  password_hash   TEXT,
  password_salt   TEXT,
  password_iter   INTEGER,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  failed_since    TEXT,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (provider, subject),
  CHECK ((provider = 'local') = (password_hash IS NOT NULL))
);
CREATE INDEX user_identities_user ON user_identities (user_id);

-- Which play account sits in which character place. The slot range is the cap (1..10).
CREATE TABLE user_characters (
  user_id     TEXT NOT NULL REFERENCES users(id),
  slot        INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 10),
  account_id  TEXT NOT NULL UNIQUE REFERENCES accounts(id),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, slot)
);

-- Sign-ins. Only the SHA-256 of the token is stored. selected_slot is the character being played.
CREATE TABLE sessions (
  token_hash     TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  provider       TEXT NOT NULL,
  selected_slot  INTEGER CHECK (selected_slot IS NULL OR selected_slot BETWEEN 1 AND 10),
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  revoked_at     TEXT
);
CREATE INDEX sessions_user ON sessions (user_id);
