-- Own scrape survives restarts: the agent job a product waits for.
ALTER TABLE products ADD COLUMN IF NOT EXISTS scrape_job_id BIGINT;
CREATE INDEX IF NOT EXISTS products_scrape_job_idx ON products (scrape_job_id) WHERE scrape_status = 'processing';
