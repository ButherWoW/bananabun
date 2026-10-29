CREATE TABLE IF NOT EXISTS tiktok_oauth_states (
  nonce       TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);