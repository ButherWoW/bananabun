-- Performance indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_pushes_status ON pushes(status);
CREATE INDEX IF NOT EXISTS idx_pushes_workspace_created ON pushes(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_workspace_created ON campaigns(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lp_events_template ON lp_events(template_id);
CREATE INDEX IF NOT EXISTS idx_lp_events_product ON lp_events(product_id);