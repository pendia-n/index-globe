CREATE TABLE bunker_service_fees (
  order_id TEXT PRIMARY KEY REFERENCES bunker_orders(id),
  payer_company_id TEXT NOT NULL REFERENCES companies(id),
  invoice_ref TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  issued_at INTEGER NOT NULL,
  issued_by TEXT NOT NULL REFERENCES users(id),
  payment_ref TEXT,
  reported_at INTEGER,
  reported_by TEXT REFERENCES users(id),
  received_at INTEGER,
  received_by TEXT REFERENCES users(id)
);
