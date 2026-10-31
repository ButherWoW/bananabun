-- Keitaro postbacks: one secret per team; the team is found only by its secret. The secret is shown to the team's
-- owner/lead to paste into Keitaro, so it is kept; the sha256 is what requests are looked up by.
CREATE TABLE IF NOT EXISTS telegram_postback_secrets (
  workspace_id VARCHAR(30) PRIMARY KEY,
  secret VARCHAR(80) NOT NULL,
  secret_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Queue: a claimed row is 'sending' (with locked_at) until the send ends; 'skipped' = the person unlinked or paused.
ALTER TABLE telegram_outbox DROP CONSTRAINT IF EXISTS telegram_outbox_status_check;
ALTER TABLE telegram_outbox ADD CONSTRAINT telegram_outbox_status_check CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped'));
ALTER TABLE telegram_outbox ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS telegram_outbox_cleanup ON telegram_outbox (created_at) WHERE status <> 'pending';
CREATE INDEX IF NOT EXISTS telegram_postbacks_received ON telegram_postbacks (received_at);
