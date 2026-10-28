ALTER TABLE creatives ADD COLUMN IF NOT EXISTS render_token VARCHAR(40);
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS render_started_at TIMESTAMPTZ;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS render_attempts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_creatives_render_queue ON creatives (created_at)
  WHERE status IN ('pending','processing') AND metadata->>'source' = 'local';
-- Unfinished legacy FA rows cannot progress in the own-only application.
UPDATE creatives SET status='failed', metadata=metadata || '{"error":"FA отключён — повторите собственную сборку из фото товара"}'::jsonb
  WHERE metadata->>'source' IN ('fa','fa_ready')
    AND (status IN ('pending','processing') OR (status='done' AND file_url IS NULL));
