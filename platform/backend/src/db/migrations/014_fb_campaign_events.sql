-- Our own campaign history: who changed what through the agent, and how it ended.
CREATE TABLE IF NOT EXISTS fb_campaign_events (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(30) REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id VARCHAR(40) NOT NULL,         -- Facebook campaign id
  job_id BIGINT,                            -- agent job, when the event is an edit
  user_id VARCHAR(30),
  text TEXT NOT NULL,
  result VARCHAR(10),                       -- queued | done | failed
  error TEXT,
  at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fb_campaign_events ON fb_campaign_events(workspace_id, campaign_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_fb_campaign_events_job ON fb_campaign_events(job_id);

ALTER TABLE fb_campaigns ADD COLUMN IF NOT EXISTS spend_cap BIGINT; -- cents; null = no cap
