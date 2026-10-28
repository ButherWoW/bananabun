-- Preset creatives after a scrape survive a crash: set together with scrape_status='done',
-- cleared once the batch is queued; the lease keeps two recovery workers from both generating.
ALTER TABLE products ADD COLUMN IF NOT EXISTS preset_creatives_due_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS preset_creatives_lease_at TIMESTAMPTZ;
