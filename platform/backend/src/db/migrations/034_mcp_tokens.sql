-- Personal tokens for the Bananabun MCP endpoint (/api/mcp). Only the sha256 of a token is stored;
-- the token itself is shown once, when it is created.
CREATE TABLE IF NOT EXISTS mcp_tokens (
  id VARCHAR(30) PRIMARY KEY,
  user_id VARCHAR(30) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  token_hint VARCHAR(12) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS mcp_tokens_user ON mcp_tokens (user_id);

-- Actions with consequences proposed through MCP. They run only after the author confirms with the human's words.
CREATE TABLE IF NOT EXISTS mcp_drafts (
  id VARCHAR(30) PRIMARY KEY,
  user_id VARCHAR(30) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id VARCHAR(30) NOT NULL,
  tool VARCHAR(40) NOT NULL,
  payload JSONB NOT NULL,
  card JSONB NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected', 'done', 'failed')),
  human_reply TEXT,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS mcp_drafts_user ON mcp_drafts (user_id, created_at DESC);
