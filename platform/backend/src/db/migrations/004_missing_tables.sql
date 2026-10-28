-- Tables/columns the code uses that prod is missing. Idempotent.

-- ── AdsPower profiles (accounts.js /sync) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS ap_profiles (
  id VARCHAR(80) PRIMARY KEY,
  workspace_id VARCHAR(30) REFERENCES workspaces(id) ON DELETE CASCADE,
  serial_number TEXT DEFAULT '',
  name TEXT DEFAULT '',
  group_id TEXT DEFAULT '',
  group_name TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  ip_country TEXT DEFAULT '',
  proxy_host TEXT DEFAULT '',
  proxy_port TEXT DEFAULT '',
  raw JSONB DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── FB accounts / BMs / cabinets / pages (accounts.js, push.js options) ─────
CREATE TABLE IF NOT EXISTS fb_accounts (
  id VARCHAR(120) PRIMARY KEY,
  workspace_id VARCHAR(30) REFERENCES workspaces(id) ON DELETE CASCADE,
  ap_profile_id VARCHAR(80),
  name TEXT,
  email TEXT,
  status VARCHAR(30) DEFAULT 'active',
  status_label TEXT,
  geo VARCHAR(10),
  bm_id TEXT,
  pixel_ids JSONB DEFAULT '[]'::jsonb,
  bms_count INTEGER DEFAULT 0,
  cabinets_count INTEGER DEFAULT 0,
  pages_count INTEGER DEFAULT 0,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE fb_accounts ADD COLUMN IF NOT EXISTS bm_id TEXT;
ALTER TABLE fb_accounts ADD COLUMN IF NOT EXISTS pixel_ids JSONB DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS fb_bms (
  id VARCHAR(200) PRIMARY KEY,
  workspace_id VARCHAR(30) REFERENCES workspaces(id) ON DELETE CASCADE,
  fb_account_id VARCHAR(120) REFERENCES fb_accounts(id) ON DELETE CASCADE,
  external_id TEXT,
  name TEXT,
  agency TEXT DEFAULT '',
  status VARCHAR(30) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- accounts.js PUT /:id/assets deletes fb_bms by account and relies on cascade to drop children
CREATE TABLE IF NOT EXISTS fb_cabinets (
  id VARCHAR(260) PRIMARY KEY,
  workspace_id VARCHAR(30) REFERENCES workspaces(id) ON DELETE CASCADE,
  bm_id VARCHAR(200) REFERENCES fb_bms(id) ON DELETE CASCADE,
  fb_account_id VARCHAR(120) REFERENCES fb_accounts(id) ON DELETE CASCADE,
  external_id TEXT,
  name TEXT,
  pixel_id TEXT,
  status VARCHAR(30) DEFAULT 'active',
  status_label TEXT,
  ready_kind VARCHAR(30) DEFAULT 'unknown',
  ready_label TEXT,
  payment_missing BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fb_pages (
  id VARCHAR(260) PRIMARY KEY,
  workspace_id VARCHAR(30) REFERENCES workspaces(id) ON DELETE CASCADE,
  bm_id VARCHAR(200) REFERENCES fb_bms(id) ON DELETE CASCADE,
  fb_account_id VARCHAR(120) REFERENCES fb_accounts(id) ON DELETE CASCADE,
  external_id TEXT,
  name TEXT,
  status VARCHAR(30) DEFAULT 'active',
  ads_running INTEGER,
  ads_limit INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fb_accounts_ws ON fb_accounts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_fb_bms_account ON fb_bms(fb_account_id);
CREATE INDEX IF NOT EXISTS idx_fb_cabinets_bm ON fb_cabinets(bm_id);
CREATE INDEX IF NOT EXISTS idx_fb_cabinets_ws ON fb_cabinets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_fb_pages_bm ON fb_pages(bm_id);

-- ── Ad settings presets (adSettings.js, push.js options) ────────────────────
CREATE TABLE IF NOT EXISTS ad_settings (
  id VARCHAR(30) PRIMARY KEY,
  workspace_id VARCHAR(30) REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by VARCHAR(30),
  name TEXT,
  age_min INTEGER DEFAULT 18,
  age_max INTEGER DEFAULT 65,
  genders TEXT DEFAULT 'all',
  devices TEXT DEFAULT 'all',
  adsets_count INTEGER DEFAULT 1,
  budget NUMERIC(12,2),
  bid_strategy TEXT,
  bid_amount NUMERIC(12,2),
  objective TEXT,
  pixel_event TEXT,
  call_to_action TEXT,
  auto_placement BOOLEAN DEFAULT true,
  url_params TEXT,
  creo_mode TEXT,
  creo_per_adset INTEGER DEFAULT 3,
  all_creatives BOOLEAN DEFAULT false,
  product_ids TEXT[] DEFAULT '{}',
  form JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ad_settings_ws ON ad_settings(workspace_id);

-- ── Product reviews (products.js /:id/reviews) ──────────────────────────────
CREATE TABLE IF NOT EXISTS product_reviews (
  id VARCHAR(30) PRIMARY KEY,
  product_id VARCHAR(30) REFERENCES products(id) ON DELETE CASCADE,
  author TEXT,
  rating INTEGER DEFAULT 5,
  text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_reviews_product ON product_reviews(product_id);

-- ── pushes: columns used by api/routes/push.js + services/push.js ──────────
ALTER TABLE pushes ADD COLUMN IF NOT EXISTS params JSONB DEFAULT '{}'::jsonb;
ALTER TABLE pushes ADD COLUMN IF NOT EXISTS log JSONB DEFAULT '[]'::jsonb;
ALTER TABLE pushes ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE pushes ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
ALTER TABLE pushes ADD COLUMN IF NOT EXISTS fb_adset_ids JSONB DEFAULT '[]'::jsonb;
ALTER TABLE pushes ADD COLUMN IF NOT EXISTS fb_ad_ids JSONB DEFAULT '[]'::jsonb;

-- ── products: bulk edit fields + wider status set ───────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;
ALTER TABLE products ADD COLUMN IF NOT EXISTS notes TEXT;

DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'products'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%(status)%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%scrape_status%'
  LOOP
    EXECUTE format('ALTER TABLE products DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE products ADD CONSTRAINT products_status_check
  CHECK (status IN ('draft','active','paused','archived','ready','no_offer'));

-- ── updated_at on every table db.update() writes (db/client.js always sets it) ──
ALTER TABLE ad_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE campaigns   ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE creatives   ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE folders     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE products    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE scrape_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE users       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE workspaces  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
