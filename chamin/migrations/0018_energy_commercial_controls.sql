ALTER TABLE energy_cases ADD COLUMN workflow_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE energy_cases ADD COLUMN blind_brief TEXT;
ALTER TABLE energy_cases ADD COLUMN route_checks TEXT;
ALTER TABLE energy_cases ADD COLUMN fee_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE energy_cases ADD COLUMN fee_payer TEXT NOT NULL DEFAULT 'seller' CHECK(fee_payer IN ('buyer','seller'));
ALTER TABLE energy_cases ADD COLUMN fee_basis TEXT NOT NULL DEFAULT 'accepted delivery value';
ALTER TABLE energy_cases ADD COLUMN fee_currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE energy_cases ADD COLUMN buyer_fee_revision INTEGER;
ALTER TABLE energy_cases ADD COLUMN commission_bps INTEGER NOT NULL DEFAULT 200 CHECK(commission_bps=200);
ALTER TABLE energy_cases ADD COLUMN operating_cost_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE energy_cases ADD COLUMN operating_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE energy_cases ADD COLUMN resume_state TEXT;
ALTER TABLE energy_cases ADD COLUMN cancellation_proposed_by TEXT REFERENCES users(id);
ALTER TABLE energy_cases ADD COLUMN cancellation_note TEXT;
ALTER TABLE energy_invitations ADD COLUMN shortlisted_at INTEGER;
ALTER TABLE energy_invitations ADD COLUMN disclosed_at INTEGER;
ALTER TABLE energy_invitations ADD COLUMN fee_accepted_revision INTEGER;
ALTER TABLE energy_invitations ADD COLUMN fee_accepted_by TEXT REFERENCES users(id);
ALTER TABLE energy_invitations ADD COLUMN fee_accepted_at INTEGER;
UPDATE energy_invitations SET disclosed_at=invited_at;
ALTER TABLE energy_offers ADD COLUMN total_minor INTEGER;
ALTER TABLE energy_offers ADD COLUMN structured_terms TEXT;
CREATE TABLE energy_offer_versions (
 id TEXT PRIMARY KEY,offer_id TEXT NOT NULL REFERENCES energy_offers(id),case_id TEXT NOT NULL REFERENCES energy_cases(id),
 revision INTEGER NOT NULL,snapshot TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(offer_id,revision)
);
CREATE TRIGGER energy_offer_snapshot_insert AFTER INSERT ON energy_offers BEGIN
 INSERT INTO energy_offer_versions VALUES(lower(hex(randomblob(16))),NEW.id,NEW.case_id,NEW.revision,
 json_object('amount',NEW.amount,'currency',NEW.currency,'unit',NEW.unit,'terms',NEW.terms,'expires_at',NEW.expires_at,'total_minor',NEW.total_minor,'structured_terms',NEW.structured_terms),NEW.created_at);
END;
CREATE TRIGGER energy_offer_snapshot_update AFTER UPDATE ON energy_offers BEGIN
 INSERT INTO energy_offer_versions VALUES(lower(hex(randomblob(16))),NEW.id,NEW.case_id,NEW.revision,
 json_object('amount',NEW.amount,'currency',NEW.currency,'unit',NEW.unit,'terms',NEW.terms,'expires_at',NEW.expires_at,'total_minor',NEW.total_minor,'structured_terms',NEW.structured_terms),unixepoch()*1000);
END;
CREATE TABLE energy_mandate_acceptances (
 case_id TEXT NOT NULL REFERENCES energy_cases(id),company_id TEXT NOT NULL REFERENCES companies(id),revision INTEGER NOT NULL,
 accepted_by TEXT NOT NULL REFERENCES users(id),accepted_at INTEGER NOT NULL,terms TEXT NOT NULL,
 PRIMARY KEY(case_id,company_id,revision)
);
CREATE TABLE energy_delivery_lots (
 id TEXT PRIMARY KEY,case_id TEXT NOT NULL REFERENCES energy_cases(id),sequence INTEGER NOT NULL,description TEXT NOT NULL,
 quantity TEXT NOT NULL,evidence_ref TEXT NOT NULL,reported_by TEXT NOT NULL REFERENCES users(id),reported_at INTEGER NOT NULL,
 accepted_by TEXT REFERENCES users(id),accepted_at INTEGER,rejected_note TEXT,
 gross_minor INTEGER NOT NULL CHECK(gross_minor>0),currency TEXT NOT NULL,commission_minor INTEGER NOT NULL CHECK(commission_minor>=0),
 payment_state TEXT NOT NULL DEFAULT 'awaiting_provider' CHECK(payment_state IN ('awaiting_provider','pending','paid','failed','refunded','disputed')),
 provider_payment_id TEXT,provider_fee_minor INTEGER,UNIQUE(case_id,sequence)
);
CREATE TABLE payment_connections (
 company_id TEXT PRIMARY KEY REFERENCES companies(id),provider_account TEXT NOT NULL UNIQUE,
 charges_enabled INTEGER NOT NULL DEFAULT 0,details_submitted INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL
);
CREATE TABLE provider_events (id TEXT PRIMARY KEY,event_type TEXT NOT NULL,occurred_at INTEGER NOT NULL,object_id TEXT NOT NULL);
CREATE TABLE platform_configuration (key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_by TEXT REFERENCES users(id),updated_at INTEGER NOT NULL);
INSERT INTO platform_configuration VALUES('payments_live_approved','false',NULL,unixepoch()*1000);
CREATE TRIGGER invite_staff_authority AFTER INSERT ON users WHEN NEW.role<>'owner' BEGIN
 UPDATE users SET authority_status='staff' WHERE id=NEW.id;
END;
