-- Configuration columns previously added manually on the original installation.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS keitaro_url TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS keitaro_api_key TEXT;

-- Own similar-product search uses a third job type on fresh installations too.
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='scrape_jobs'::regclass AND contype='c'
      AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='scrape_jobs'::regclass AND attname='type')]::smallint[]
  LOOP EXECUTE format('ALTER TABLE scrape_jobs DROP CONSTRAINT %I',constraint_name); END LOOP;
END $$;
ALTER TABLE scrape_jobs ADD CONSTRAINT scrape_jobs_type_check CHECK(type IN ('product','search','similar'));
