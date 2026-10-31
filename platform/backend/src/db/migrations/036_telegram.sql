-- Telegram notifications: who is linked, personal and team settings, and the outgoing queue / delivery log.
CREATE TABLE IF NOT EXISTS telegram_links (
  user_id VARCHAR(30) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  chat_id BIGINT NOT NULL UNIQUE,
  username VARCHAR(64),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  muted BOOLEAN NOT NULL DEFAULT false,
  blocked_at TIMESTAMPTZ
);

-- One-time link codes: only the sha256 is stored, valid 15 minutes.
CREATE TABLE IF NOT EXISTS telegram_link_codes (
  code_hash CHAR(64) PRIMARY KEY,
  user_id VARCHAR(30) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS telegram_link_codes_user ON telegram_link_codes (user_id);

-- Personal overrides per event; a missing row means «as the team settings say».
CREATE TABLE IF NOT EXISTS telegram_prefs (
  user_id VARCHAR(30) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event VARCHAR(40) NOT NULL,
  enabled BOOLEAN NOT NULL,
  threshold JSONB,
  PRIMARY KEY (user_id, event)
);

-- Team settings: events on by default, thresholds, digest time and timezone, quiet hours.
CREATE TABLE IF NOT EXISTS telegram_settings (
  workspace_id VARCHAR(30) PRIMARY KEY,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Outgoing messages. dedupe_key makes one event one message per recipient.
CREATE TABLE IF NOT EXISTS telegram_outbox (
  id BIGSERIAL PRIMARY KEY,
  workspace_id VARCHAR(30),
  user_id VARCHAR(30) REFERENCES users(id) ON DELETE SET NULL,
  chat_id BIGINT NOT NULL,
  event VARCHAR(40) NOT NULL,
  text TEXT NOT NULL,
  dedupe_key VARCHAR(200) NOT NULL UNIQUE,
  urgent BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS telegram_outbox_due ON telegram_outbox (next_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS telegram_outbox_ws ON telegram_outbox (workspace_id, created_at DESC);

-- Keitaro conversion postbacks received for the bot (no secrets stored).
CREATE TABLE IF NOT EXISTS telegram_postbacks (
  id BIGSERIAL PRIMARY KEY,
  workspace_id VARCHAR(30),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(30),
  payout NUMERIC,
  currency VARCHAR(10),
  campaign VARCHAR(300),
  offer VARCHAR(300),
  country VARCHAR(10),
  buyer VARCHAR(100),
  click_id VARCHAR(200),
  duplicate BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS telegram_postbacks_ws ON telegram_postbacks (workspace_id, received_at DESC);
-- The first postback of a click and status wins atomically; repeats are stored as duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS telegram_postbacks_first ON telegram_postbacks (workspace_id, click_id, status)
  WHERE NOT duplicate AND click_id IS NOT NULL;
