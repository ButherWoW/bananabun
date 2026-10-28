-- Ad preset fields the push now honours: a bid per adset and manual placements.
ALTER TABLE ad_settings ADD COLUMN IF NOT EXISTS bid_amounts JSONB;          -- [bid adset 1, bid adset 2, ...]; null = one bid for all
ALTER TABLE ad_settings ADD COLUMN IF NOT EXISTS platforms TEXT[] DEFAULT '{}'; -- publisher platforms when auto_placement is off
