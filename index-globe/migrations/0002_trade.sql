CREATE TABLE solar_offers (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES users(id),
  site TEXT NOT NULL,
  region TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  volume_kwh INTEGER NOT NULL CHECK (volume_kwh > 0),
  price_pence INTEGER NOT NULL CHECK (price_pence >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'withdrawn')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE deals (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES solar_offers(id),
  buyer_id TEXT NOT NULL REFERENCES users(id),
  seller_id TEXT NOT NULL REFERENCES users(id),
  supplier_id TEXT REFERENCES users(id),
  buyer_site TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'negotiating' CHECK (status IN ('negotiating', 'supplier_review', 'changes_requested', 'reviewed')),
  quote_version INTEGER NOT NULL DEFAULT 1 CHECK (quote_version > 0),
  supplier_name TEXT,
  supplier_reference TEXT,
  supplier_note TEXT,
  sleeve_price_pence INTEGER,
  remaining_price_pence INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (offer_id, buyer_id),
  CHECK (buyer_id <> seller_id),
  CHECK (supplier_id IS NULL OR (supplier_id <> buyer_id AND supplier_id <> seller_id))
);

CREATE TABLE deal_quotes (
  deal_id TEXT NOT NULL REFERENCES deals(id),
  version INTEGER NOT NULL CHECK (version > 0),
  author_id TEXT NOT NULL REFERENCES users(id),
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  volume_kwh INTEGER NOT NULL CHECK (volume_kwh > 0),
  price_pence INTEGER NOT NULL CHECK (price_pence >= 0),
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (deal_id, version)
);

CREATE TABLE deal_meter_files (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL REFERENCES deals(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('buyer', 'seller')),
  object_key TEXT NOT NULL UNIQUE,
  intervals INTEGER NOT NULL CHECK (intervals > 0),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  UNIQUE (deal_id, role, sequence)
);

CREATE INDEX solar_offers_board ON solar_offers (status, created_at DESC);
CREATE INDEX deals_buyer ON deals (buyer_id, updated_at DESC);
CREATE INDEX deals_seller ON deals (seller_id, updated_at DESC);
CREATE INDEX deals_supplier ON deals (supplier_id, updated_at DESC);
