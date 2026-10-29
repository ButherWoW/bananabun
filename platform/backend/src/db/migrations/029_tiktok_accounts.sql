-- TikTok Ads accounts
CREATE TABLE IF NOT EXISTS tiktok_accounts (
  id VARCHAR(30) PRIMARY KEY,
  workspace_id VARCHAR(30) REFERENCES workspaces(id) ON DELETE CASCADE,
  advertiser_id VARCHAR(50) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  name VARCHAR(255),
  currency VARCHAR(5) DEFAULT 'EUR',
  timezone VARCHAR(50),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disabled')),
  pixel_id VARCHAR(50),
  created_by VARCHAR(30) REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tiktok_accounts_workspace ON tiktok_accounts(workspace_id);