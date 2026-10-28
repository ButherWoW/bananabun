-- Users / Workspace
CREATE TABLE workspaces (
  id VARCHAR(30) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE users (
  id VARCHAR(30) PRIMARY KEY,
  workspace_id VARCHAR(30) REFERENCES workspaces(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'buyer' CHECK (role IN ('owner', 'lead', 'buyer')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Product Folders
CREATE TABLE folders (
  id VARCHAR(30) PRIMARY KEY,
  workspace_id VARCHAR(30) REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  parent_id VARCHAR(30) REFERENCES folders(id) ON DELETE SET NULL,
  shared BOOLEAN DEFAULT false,
  created_by VARCHAR(30) REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products
CREATE TABLE products (
  id VARCHAR(30) PRIMARY KEY,
  workspace_id VARCHAR(30) REFERENCES workspaces(id) ON DELETE CASCADE,
  folder_id VARCHAR(30) REFERENCES folders(id) ON DELETE SET NULL,
  created_by VARCHAR(30) REFERENCES users(id),

  -- Source
  source VARCHAR(20) DEFAULT 'amazon' CHECK (source IN ('amazon', 'cdiscount', 'manual')),
  source_id VARCHAR(100),  -- ASIN
  marketplace VARCHAR(10) DEFAULT 'fr',
  source_url TEXT,

  -- Product data
  title TEXT,
  description TEXT,
  source_price DECIMAL(10,2),
  images JSONB DEFAULT '[]',
  rating DECIMAL(3,1),
  reviews_count INTEGER DEFAULT 0,
  photo_reviews_count INTEGER DEFAULT 0,

  -- Bundle config
  bundle_preset_id VARCHAR(30),
  bundle_config JSONB DEFAULT '{}',

  -- Status
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  scrape_status VARCHAR(20) DEFAULT 'pending' CHECK (scrape_status IN ('pending', 'processing', 'done', 'failed')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bundle Presets
CREATE TABLE bundle_presets (
  id VARCHAR(30) PRIMARY KEY,
  workspace_id VARCHAR(30) REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  currency VARCHAR(3) DEFAULT 'EUR',
  config JSONB NOT NULL,  -- [{qty:1, offer_id:...}, {qty:3, gift:true}]
  created_by VARCHAR(30) REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Creatives
CREATE TABLE creatives (
  id VARCHAR(30) PRIMARY KEY,
  product_id VARCHAR(30) REFERENCES products(id) ON DELETE CASCADE,
  workspace_id VARCHAR(30) REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by VARCHAR(30) REFERENCES users(id),

  preset_id VARCHAR(30),
  type VARCHAR(20) DEFAULT 'image' CHECK (type IN ('image', 'video', 'carousel')),
  format VARCHAR(20),  -- '1x1', '4x5', '9x16'
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),

  file_url TEXT,
  thumbnail_url TEXT,
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Creative Presets
CREATE TABLE creative_presets (
  id VARCHAR(30) PRIMARY KEY,
  workspace_id VARCHAR(30) REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  template JSONB NOT NULL,
  formats JSONB DEFAULT '["1x1","4x5","9x16"]',
  created_by VARCHAR(30) REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scrape Jobs
CREATE TABLE scrape_jobs (
  id VARCHAR(30) PRIMARY KEY,
  workspace_id VARCHAR(30) REFERENCES workspaces(id) ON DELETE CASCADE,
  type VARCHAR(20) CHECK (type IN ('product', 'search')),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  params JSONB NOT NULL,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id VARCHAR(30) PRIMARY KEY,
  workspace_id VARCHAR(30),
  product_id VARCHAR(30),
  name VARCHAR(255),
  status VARCHAR(20) DEFAULT 'draft',
  daily_budget DECIMAL(10,2),
  spend DECIMAL(10,2) DEFAULT 0,
  revenue DECIMAL(10,2) DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  fb_campaign_id VARCHAR(100),
  targeting JSONB DEFAULT '{}',
  created_by VARCHAR(30),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Landing Templates
CREATE TABLE IF NOT EXISTS landing_templates (
  id VARCHAR(30) PRIMARY KEY,
  workspace_id VARCHAR(30),
  name VARCHAR(255) NOT NULL,
  html TEXT DEFAULT '',
  geo VARCHAR(10) DEFAULT '',
  type VARCHAR(30) DEFAULT 'html',
  fa_id VARCHAR(100),
  synced_at TIMESTAMPTZ,
  state VARCHAR(20) DEFAULT 'ready',
  store VARCHAR(50),
  geos JSONB DEFAULT '[]',
  versions JSONB DEFAULT '[]',
  created_by VARCHAR(30),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_workspace ON products(workspace_id);
CREATE INDEX IF NOT EXISTS idx_landing_templates_workspace ON landing_templates(workspace_id);
CREATE INDEX IF NOT EXISTS idx_products_folder ON products(folder_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_creatives_product ON creatives(product_id);
CREATE INDEX IF NOT EXISTS idx_folders_workspace ON folders(workspace_id);
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_status ON scrape_jobs(status);
