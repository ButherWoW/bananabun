ALTER TABLE products ADD COLUMN IF NOT EXISTS engine VARCHAR(10) DEFAULT 'own';
ALTER TABLE products ADD COLUMN IF NOT EXISTS external_id VARCHAR(80);
ALTER TABLE products ADD COLUMN IF NOT EXISTS external_images JSONB DEFAULT '[]'::jsonb;
ALTER TABLE products ADD COLUMN IF NOT EXISTS scrape_started_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS products_engine_sync_idx ON products (engine, scrape_status) WHERE external_id IS NOT NULL;
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'products'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%source%'
  LOOP
    EXECUTE format('ALTER TABLE products DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE products ADD CONSTRAINT products_source_check
  CHECK (source IN ('amazon', 'walmart', 'target', 'bestbuy', 'etsy', 'cdiscount', 'manual'));
