-- Legacy unowned jobs remain available to owner/lead; never invent a buyer owner.
ALTER TABLE scrape_jobs ADD COLUMN IF NOT EXISTS created_by VARCHAR(30);
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_author ON scrape_jobs (workspace_id, created_by, created_at DESC);
