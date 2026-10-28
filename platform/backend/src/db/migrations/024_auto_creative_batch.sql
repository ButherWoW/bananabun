-- An internal scrape event and slot identify one automatic creative.
-- Manual requests do not set this key and can intentionally generate more images.
CREATE UNIQUE INDEX IF NOT EXISTS idx_creatives_auto_batch_slot
  ON creatives (product_id, (metadata->>'auto_batch_key'), (metadata->>'auto_slot'))
  WHERE metadata ? 'auto_batch_key';
