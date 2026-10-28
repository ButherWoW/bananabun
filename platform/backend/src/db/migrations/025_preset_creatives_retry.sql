-- Preset creatives after a scrape: a failed attempt keeps the mark, counts the attempt and shows why.
ALTER TABLE products ADD COLUMN IF NOT EXISTS preset_creatives_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS preset_creatives_error TEXT;
