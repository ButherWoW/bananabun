-- Add images and scraped flag to product_reviews
ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;
ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS scraped BOOLEAN DEFAULT false;