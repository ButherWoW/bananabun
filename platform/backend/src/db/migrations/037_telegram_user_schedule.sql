-- Personal delivery time: a window «from … to …» (local hours; empty = around the clock), the person's time zone
-- and digest hour (empty = the team's). Messages held outside the window are sent together when it opens.
ALTER TABLE telegram_links ADD COLUMN IF NOT EXISTS deliver_from SMALLINT CHECK (deliver_from BETWEEN 0 AND 23);
ALTER TABLE telegram_links ADD COLUMN IF NOT EXISTS deliver_to SMALLINT CHECK (deliver_to BETWEEN 0 AND 23);
ALTER TABLE telegram_links ADD COLUMN IF NOT EXISTS timezone VARCHAR(64);
ALTER TABLE telegram_links ADD COLUMN IF NOT EXISTS digest_hour SMALLINT CHECK (digest_hour BETWEEN 0 AND 23);
ALTER TABLE telegram_outbox ADD COLUMN IF NOT EXISTS held BOOLEAN NOT NULL DEFAULT false;
