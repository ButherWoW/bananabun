-- FB spend for 3 and 30 days (NULL = not read yet by an agent that knows these periods);
-- «В архив» is a platform mark only: FB campaigns are not archived in Facebook.
ALTER TABLE fb_campaigns ADD COLUMN IF NOT EXISTS spend_3d NUMERIC;
ALTER TABLE fb_campaigns ADD COLUMN IF NOT EXISTS spend_30d NUMERIC;
ALTER TABLE fb_campaigns ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE fb_campaigns ADD COLUMN IF NOT EXISTS archived_by VARCHAR(30);
