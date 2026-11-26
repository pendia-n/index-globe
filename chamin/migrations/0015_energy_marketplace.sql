CREATE TABLE energy_cases (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), created_by TEXT NOT NULL REFERENCES users(id),
 side TEXT NOT NULL CHECK(side IN ('buy','sell')), product TEXT NOT NULL, country TEXT NOT NULL, delivery_point TEXT NOT NULL,
 title TEXT NOT NULL, details TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'submitted', revision INTEGER NOT NULL DEFAULT 0,
 operator_id TEXT REFERENCES users(id), next_action TEXT NOT NULL DEFAULT 'Awaiting Teder triage', next_at INTEGER,
 route_note TEXT, fee_terms TEXT, selected_offer TEXT, contract_ref TEXT, security_ref TEXT,
 buyer_signed INTEGER NOT NULL DEFAULT 0, seller_signed INTEGER NOT NULL DEFAULT 0,
 delivery_ref TEXT, delivery_accepted INTEGER NOT NULL DEFAULT 0, invoice_ref TEXT, payment_ref TEXT, payment_received INTEGER NOT NULL DEFAULT 0,
 fee_ref TEXT, fee_payment_ref TEXT, fee_received INTEGER NOT NULL DEFAULT 0,
 last_actor TEXT NOT NULL REFERENCES users(id), last_note TEXT NOT NULL, updated_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE energy_invitations (
 case_id TEXT NOT NULL REFERENCES energy_cases(id), company_id TEXT NOT NULL REFERENCES companies(id), invited_at INTEGER NOT NULL,
 PRIMARY KEY(case_id,company_id)
);
CREATE TABLE energy_offers (
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES energy_cases(id), company_id TEXT NOT NULL REFERENCES companies(id),
 amount REAL NOT NULL CHECK(amount>0), currency TEXT NOT NULL, unit TEXT NOT NULL, terms TEXT NOT NULL, expires_at INTEGER NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, UNIQUE(case_id,company_id)
);
CREATE TABLE energy_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL REFERENCES energy_cases(id), actor_id TEXT NOT NULL REFERENCES users(id),
 note TEXT NOT NULL, occurred_at INTEGER NOT NULL
);
CREATE TRIGGER energy_case_created AFTER INSERT ON energy_cases BEGIN
 INSERT INTO energy_events(case_id,actor_id,note,occurred_at) VALUES(NEW.id,NEW.last_actor,NEW.last_note,NEW.updated_at);
END;
CREATE TRIGGER energy_case_updated AFTER UPDATE ON energy_cases BEGIN
 INSERT INTO energy_events(case_id,actor_id,note,occurred_at) VALUES(NEW.id,NEW.last_actor,NEW.last_note,NEW.updated_at);
END;
CREATE INDEX energy_case_company ON energy_cases(company_id,updated_at);
CREATE INDEX energy_match ON energy_cases(side,product,country,state);
