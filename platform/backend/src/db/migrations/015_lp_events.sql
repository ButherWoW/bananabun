-- Visitor events from our own landing tracker (POST /api/t). Kept 30 days.
CREATE TABLE IF NOT EXISTS lp_events (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ DEFAULT NOW(),
  visitor VARCHAR(40) NOT NULL,             -- random per browser tab
  campaign_id VARCHAR(40),                  -- FB campaign id from the link (= sub_id_2)
  adset_id VARCHAR(40),
  ad_id VARCHAR(40),
  template_id VARCHAR(40),
  product_id VARCHAR(40),
  geo VARCHAR(4),
  event VARCHAR(20) NOT NULL,               -- view | seen | depth | click | buy_click | bundle_select | quiz_answer | leave
  block VARCHAR(40),
  num INTEGER,                              -- depth mark, quiz step or seconds on page
  device VARCHAR(10),
  os VARCHAR(10),
  app VARCHAR(12),
  placement VARCHAR(60),
  source VARCHAR(40),
  country VARCHAR(4)
);
CREATE INDEX IF NOT EXISTS idx_lp_events_campaign ON lp_events(campaign_id, at);
CREATE INDEX IF NOT EXISTS idx_lp_events_at ON lp_events(at);
