CREATE TABLE pilot_requests (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  stripe_invoice_id TEXT UNIQUE,
  agreed_minor_units INTEGER CHECK (agreed_minor_units > 0),
  agreed_currency TEXT,
  paid_at TEXT,
  stripe_paid_event_id TEXT UNIQUE
);
