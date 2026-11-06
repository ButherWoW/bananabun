-- Session revocation: a login token carries the user's token_version (claim "tv"); a password reset or a role
-- change bumps the number, and every older token stops working at once. Tokens issued before this migration have
-- no claim and count as version 0, so nobody is logged out by the deploy itself.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
