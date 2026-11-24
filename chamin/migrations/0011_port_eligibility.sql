ALTER TABLE bunker_supplier_eligibility ADD COLUMN revoked_at INTEGER;
ALTER TABLE bunker_broker_eligibility ADD COLUMN revoked_at INTEGER;

CREATE TABLE bunker_eligibility_events (
  id TEXT PRIMARY KEY,
  port_code TEXT NOT NULL REFERENCES bunker_ports(code),
  company_id TEXT REFERENCES companies(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK(action IN ('port-enabled','port-paused','supplier-approved','broker-approved','supplier-revoked','broker-revoked')),
  note TEXT NOT NULL,
  occurred_at INTEGER NOT NULL
);
CREATE INDEX bunker_eligibility_history ON bunker_eligibility_events(port_code,occurred_at DESC);
