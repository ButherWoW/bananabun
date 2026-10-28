-- Photo reviews exist (the «Reviews with images» carousel); their number is behind Amazon sign-in.
ALTER TABLE products ADD COLUMN IF NOT EXISTS has_photo_reviews BOOLEAN;
