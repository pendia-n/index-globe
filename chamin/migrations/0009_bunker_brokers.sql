CREATE TABLE bunker_broker_eligibility (
  port_code TEXT NOT NULL REFERENCES bunker_ports(code),
  company_id TEXT NOT NULL REFERENCES companies(id),
  authority_reference TEXT NOT NULL,
  valid_until INTEGER NOT NULL,
  approved_by TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY(port_code, company_id)
);

CREATE TABLE bunker_broker_assignments (
  enquiry_id TEXT PRIMARY KEY REFERENCES bunker_enquiries(id),
  broker_company_id TEXT NOT NULL REFERENCES companies(id),
  assigned_by TEXT NOT NULL REFERENCES users(id),
  assigned_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX bunker_assigned_broker ON bunker_broker_assignments(broker_company_id,revoked_at);

CREATE TABLE bunker_broker_activity (
  id TEXT PRIMARY KEY,
  enquiry_id TEXT NOT NULL REFERENCES bunker_enquiries(id),
  broker_company_id TEXT NOT NULL REFERENCES companies(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  event TEXT NOT NULL CHECK(event IN ('assigned','revoked','note')),
  note TEXT NOT NULL,
  occurred_at INTEGER NOT NULL
);
CREATE INDEX bunker_broker_activity_enquiry ON bunker_broker_activity(enquiry_id,occurred_at);
