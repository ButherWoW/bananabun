-- Local agent on the buyer's Mac talks to AdsPower; the server never reaches 127.0.0.1 of the Mac.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS agent_key_hash TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS agent_seen_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS agent_jobs (
  id BIGSERIAL PRIMARY KEY,
  workspace_id VARCHAR(30) REFERENCES workspaces(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  status VARCHAR(20) DEFAULT 'pending',
  result JSONB,
  created_by VARCHAR(30),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  taken_at TIMESTAMPTZ,
  done_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_jobs_pending ON agent_jobs (workspace_id, status, id);

-- Profiles used to be stored whole: remark/platform_account carry passwords and FB tokens.
UPDATE ap_profiles SET
  raw = jsonb_build_object('user_id', raw->>'user_id', 'serial_number', raw->>'serial_number'),
  ip = '', proxy_host = '', proxy_port = '';
