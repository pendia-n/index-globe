CREATE TABLE supply_requests (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL REFERENCES users(id),
  region TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  volume_kwh INTEGER NOT NULL CHECK (volume_kwh > 0),
  source TEXT,
  certificates INTEGER NOT NULL DEFAULT 0 CHECK (certificates IN (0,1)),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed'))
);
ALTER TABLE power_offers ADD COLUMN request_id TEXT REFERENCES supply_requests(id);
CREATE UNIQUE INDEX one_quote_per_request ON power_offers(request_id,seller_id) WHERE request_id IS NOT NULL;
CREATE TABLE approved_suppliers (user_id TEXT PRIMARY KEY REFERENCES users(id), supplier_name TEXT NOT NULL);
