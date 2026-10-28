-- Cabinet daily spend limit and currency, refreshed with every campaign read (for «куда лить»).
ALTER TABLE fb_cabinets ADD COLUMN IF NOT EXISTS currency VARCHAR(10);
ALTER TABLE fb_cabinets ADD COLUMN IF NOT EXISTS daily_limit NUMERIC;      -- account currency; null = no limit known
ALTER TABLE fb_cabinets ADD COLUMN IF NOT EXISTS account_status INTEGER;   -- Facebook account_status, 1 = active
ALTER TABLE fb_cabinets ADD COLUMN IF NOT EXISTS limits_at TIMESTAMPTZ;
