-- Default Keitaro campaign params for auto-campaign creation on landing generate.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS keitaro_group_id INT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS keitaro_domain_id INT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS keitaro_offer_ids JSONB DEFAULT '[]'::jsonb;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS keitaro_white_id INT;
