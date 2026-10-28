-- Moderation of our own FB campaign list: per-ad status lives in adsets[].ads, the campaign keeps the totals.
ALTER TABLE fb_campaigns ADD COLUMN IF NOT EXISTS moderation JSONB;      -- {total, rejected, issues, review, label}
ALTER TABLE fb_campaigns ADD COLUMN IF NOT EXISTS account_status INTEGER; -- Facebook ad account status (1 = active)
