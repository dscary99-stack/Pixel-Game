-- Sign-up limit per network address (P21 signupsPerIpPerHour). Only a SHA-256 of the address is kept,
-- rows older than a day are removed by the next sign-up, and the limit is checked and taken in one INSERT.
CREATE TABLE signup_attempts (
  nonce     TEXT PRIMARY KEY,
  ip_hash   TEXT NOT NULL,
  at        TEXT NOT NULL
);
CREATE INDEX signup_attempts_ip ON signup_attempts (ip_hash, at);
CREATE INDEX signup_attempts_at ON signup_attempts (at);
