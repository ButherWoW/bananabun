-- Favorite flag for creatives
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS favorite BOOLEAN DEFAULT false;

-- Dismissed flag for pushes (move failed pushes out of main view)
ALTER TABLE pushes ADD COLUMN IF NOT EXISTS dismissed BOOLEAN DEFAULT false;
