-- Our own campaign list: read from Facebook through the Mac agent (no FA).
CREATE TABLE IF NOT EXISTS fb_campaigns (
  id VARCHAR(40) PRIMARY KEY,               -- Facebook campaign id (= sub_id_2 in Keitaro)
  workspace_id VARCHAR(30) REFERENCES workspaces(id) ON DELETE CASCADE,
  fb_account_id VARCHAR(120) REFERENCES fb_accounts(id) ON DELETE CASCADE,
  act_id VARCHAR(40),
  act_name TEXT,
  currency VARCHAR(10),
  name TEXT,
  status VARCHAR(30),
  effective_status VARCHAR(30),
  daily_budget BIGINT,                      -- cents
  spend_today NUMERIC DEFAULT 0,            -- account currency
  spend_yesterday NUMERIC DEFAULT 0,
  spend_7d NUMERIC DEFAULT 0,
  adsets JSONB DEFAULT '[]'::jsonb,         -- [{id,name,status,effective_status,daily_budget,bid_amount}]
  created_time TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fb_campaigns_ws ON fb_campaigns(workspace_id);
CREATE INDEX IF NOT EXISTS idx_fb_campaigns_account ON fb_campaigns(fb_account_id);
