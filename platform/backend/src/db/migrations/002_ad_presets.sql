-- Ad Presets (Facebook campaign settings)
CREATE TABLE IF NOT EXISTS ad_presets (
  id VARCHAR(30) PRIMARY KEY,
  workspace_id VARCHAR(30),
  name VARCHAR(255) NOT NULL,
  objective VARCHAR(50) DEFAULT 'OUTCOME_SALES',
  daily_budget DECIMAL(10,2) DEFAULT 10,
  bid_strategy VARCHAR(50) DEFAULT 'LOWEST_COST_WITHOUT_CAP',
  bid_amount DECIMAL(10,2),
  optimization_goal VARCHAR(50) DEFAULT 'OFFSITE_CONVERSIONS',
  billing_event VARCHAR(50) DEFAULT 'IMPRESSIONS',
  fb_cabinet_id VARCHAR(100),
  fb_page_id VARCHAR(100),
  fb_pixel_id VARCHAR(100),
  pixel_event VARCHAR(100) DEFAULT 'Purchase',
  countries JSONB DEFAULT '[]',
  age_min INTEGER DEFAULT 18,
  age_max INTEGER DEFAULT 65,
  created_by VARCHAR(30),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pushes (залив история)
CREATE TABLE IF NOT EXISTS pushes (
  id VARCHAR(30) PRIMARY KEY,
  workspace_id VARCHAR(30),
  product_id VARCHAR(30),
  campaign_id VARCHAR(30),
  lander_id VARCHAR(100),
  lander_name VARCHAR(255),
  geo VARCHAR(10),
  ad_preset_id VARCHAR(30),
  fb_cabinet_id VARCHAR(100),
  fb_page_id VARCHAR(100),
  fb_pixel_id VARCHAR(100),
  creative_ids JSONB DEFAULT '[]',
  status VARCHAR(20) DEFAULT 'pending',
  error TEXT,
  fb_campaign_id VARCHAR(100),
  fb_adset_id VARCHAR(100),
  kt_campaign_id VARCHAR(100),
  created_by VARCHAR(30),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_presets_workspace ON ad_presets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_pushes_workspace ON pushes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_pushes_campaign ON pushes(campaign_id);
