CREATE TABLE bunker_ports (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1))
);

INSERT INTO bunker_ports(code,name,time_zone) VALUES
  ('SGSIN','Singapore','Asia/Singapore'),
  ('AEFJR','Fujairah','Asia/Dubai'),
  ('NLRTM','Rotterdam','Europe/Amsterdam');

CREATE TABLE bunker_operators (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  granted_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE bunker_enquiries (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  work_email TEXT NOT NULL,
  port_code TEXT NOT NULL REFERENCES bunker_ports(code),
  grade TEXT NOT NULL CHECK (grade IN ('VLSFO','MGO')),
  quantity_kg INTEGER NOT NULL CHECK (quantity_kg > 0),
  arrival_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL CHECK (end_at > arrival_at),
  buyer_company_id TEXT REFERENCES companies(id),
  assigned_by TEXT REFERENCES users(id),
  assigned_at INTEGER,
  declined_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX bunker_enquiries_buyer ON bunker_enquiries(buyer_company_id, created_at);
