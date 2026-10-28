-- Keep the shop's actual currency, especially for regional Etsy listings.
ALTER TABLE products ADD COLUMN IF NOT EXISTS source_currency VARCHAR(3);
