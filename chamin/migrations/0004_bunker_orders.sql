CREATE TABLE bunker_supplier_eligibility (
  port_code TEXT NOT NULL REFERENCES bunker_ports(code),
  company_id TEXT NOT NULL REFERENCES companies(id),
  licence_reference TEXT NOT NULL,
  valid_until INTEGER NOT NULL,
  approved_by TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (port_code, company_id)
);
CREATE TABLE bunker_invitations (
  enquiry_id TEXT NOT NULL REFERENCES bunker_enquiries(id),
  supplier_id TEXT NOT NULL REFERENCES companies(id),
  invited_at INTEGER NOT NULL,
  PRIMARY KEY (enquiry_id,supplier_id)
);
CREATE INDEX bunker_invited_supplier ON bunker_invitations(supplier_id,enquiry_id);
ALTER TABLE bunker_enquiries ADD COLUMN vessel TEXT;
ALTER TABLE bunker_enquiries ADD COLUMN imo TEXT;
ALTER TABLE bunker_enquiries ADD COLUMN specification TEXT;

CREATE TABLE bunker_quotes (
  id TEXT PRIMARY KEY,
  enquiry_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('indicative','firm','counter')),
  price_cents_per_tonne INTEGER NOT NULL CHECK (price_cents_per_tonne>0),
  extras_cents INTEGER NOT NULL CHECK (extras_cents>=0),
  terms TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (enquiry_id,supplier_id) REFERENCES bunker_invitations(enquiry_id,supplier_id),
  UNIQUE (enquiry_id,supplier_id,revision)
);
CREATE TABLE bunker_orders (
  id TEXT PRIMARY KEY,
  enquiry_id TEXT NOT NULL REFERENCES bunker_enquiries(id),
  quote_id TEXT NOT NULL UNIQUE REFERENCES bunker_quotes(id),
  selected_by TEXT NOT NULL REFERENCES users(id),
  selected_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('selected','confirmed','declined','withdrawn')),
  responded_by TEXT REFERENCES users(id),
  responded_at INTEGER,
  response_reference TEXT
);
CREATE UNIQUE INDEX bunker_one_order ON bunker_orders(enquiry_id) WHERE status IN ('selected','confirmed');
