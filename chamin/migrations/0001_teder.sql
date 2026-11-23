CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  registration TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by TEXT,
  reviewed_at INTEGER,
  review_note TEXT
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  auth_version INTEGER NOT NULL DEFAULT 1,
  company_id TEXT NOT NULL REFERENCES companies(id),
  role TEXT NOT NULL CHECK (role IN ('owner','trader','operator','viewer')),
  reviewer INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE auth_limits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE staff_invites (
  hash TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  role TEXT NOT NULL CHECK (role IN ('trader','operator','viewer')),
  expires_at INTEGER NOT NULL,
  used_by TEXT
);
CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL REFERENCES companies(id),
  seller_id TEXT NOT NULL REFERENCES companies(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  point TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  closes_at INTEGER NOT NULL,
  kw INTEGER NOT NULL,
  requirements TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (buyer_id <> seller_id AND end_at > start_at AND kw > 0)
);
CREATE INDEX request_buyer ON requests(buyer_id, created_at);
CREATE INDEX request_seller ON requests(seller_id, created_at);
CREATE TABLE offers (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id),
  revision INTEGER NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('firm','indicative','counter')),
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  terms TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(request_id, revision)
);
CREATE TABLE deals (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE REFERENCES requests(id),
  offer_id TEXT NOT NULL UNIQUE REFERENCES offers(id),
  selected_by TEXT NOT NULL REFERENCES users(id),
  selected_at INTEGER NOT NULL,
  agreement_ref TEXT,
  buyer_signed_by TEXT REFERENCES users(id),
  buyer_signed_at INTEGER,
  seller_signed_by TEXT REFERENCES users(id),
  seller_signed_at INTEGER,
  schedule_ref TEXT,
  scheduler_name TEXT,
  scheduled_by TEXT REFERENCES users(id),
  scheduled_at INTEGER,
  current_delivery_id TEXT,
  delivery_status TEXT CHECK (delivery_status IN ('reported','disputed','reconciled')),
  review_note TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at INTEGER,
  settlement_ref TEXT,
  settled_by TEXT REFERENCES users(id),
  settled_at INTEGER
);
CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL REFERENCES deals(id),
  reported_by TEXT NOT NULL REFERENCES users(id),
  issuer TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  measured_wh INTEGER NOT NULL CHECK (measured_wh >= 0),
  reported_at INTEGER NOT NULL
);
CREATE INDEX delivery_deal ON deliveries(deal_id, reported_at);
CREATE TABLE deal_events (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL REFERENCES deals(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  occurred_at INTEGER NOT NULL
);
CREATE INDEX event_deal ON deal_events(deal_id, occurred_at);
