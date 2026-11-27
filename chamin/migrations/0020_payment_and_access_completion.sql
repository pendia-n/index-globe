CREATE TABLE payment_attempts (
 id TEXT PRIMARY KEY,lot_id TEXT NOT NULL REFERENCES energy_delivery_lots(id),attempt INTEGER NOT NULL,
 provider_account TEXT NOT NULL,checkout_session TEXT UNIQUE,checkout_url TEXT,expires_at INTEGER,payment_intent TEXT UNIQUE,charge_id TEXT,
 state TEXT NOT NULL DEFAULT 'creating',currency TEXT NOT NULL,total_minor INTEGER NOT NULL,commission_minor INTEGER NOT NULL,
 refunded_minor INTEGER NOT NULL DEFAULT 0,fee_refunded_minor INTEGER NOT NULL DEFAULT 0,dispute_id TEXT,last_event_at INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(lot_id,attempt)
);
CREATE UNIQUE INDEX payment_active_attempt ON payment_attempts(lot_id) WHERE state IN ('creating','open','pending','paid','disputed');
CREATE TABLE payment_customers (
 buyer_company_id TEXT NOT NULL REFERENCES companies(id),supplier_company_id TEXT NOT NULL REFERENCES companies(id),provider_customer TEXT NOT NULL,
 PRIMARY KEY(buyer_company_id,supplier_company_id)
);
CREATE TABLE payment_route_approvals (
 product TEXT NOT NULL,country TEXT NOT NULL,currency TEXT NOT NULL,max_minor INTEGER NOT NULL,valid_until INTEGER NOT NULL,
 approval_reference TEXT NOT NULL,approved_by TEXT NOT NULL REFERENCES users(id),approved_at INTEGER NOT NULL,
 PRIMARY KEY(product,country,currency)
);
CREATE TABLE company_access_requests (
 id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),full_name TEXT NOT NULL,work_email TEXT NOT NULL,
 username TEXT NOT NULL,note TEXT NOT NULL,receipt_hash TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,
 decision TEXT,decision_note TEXT,invite_hash TEXT REFERENCES staff_invites(hash),invite_token TEXT,
 decided_by TEXT REFERENCES users(id),decided_at INTEGER
);
CREATE INDEX company_access_queue ON company_access_requests(company_id,decision,created_at);
CREATE TABLE dm_handover_events (
 id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES dm_conversations(id),prior_user_id TEXT NOT NULL REFERENCES users(id),
 next_user_id TEXT NOT NULL REFERENCES users(id),actor_id TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL
);
ALTER TABLE energy_offers ADD COLUMN entered_by TEXT REFERENCES users(id);
ALTER TABLE energy_offers ADD COLUMN supplier_confirmed_at INTEGER;
ALTER TABLE energy_cases ADD COLUMN sourcing_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE energy_offers ADD COLUMN sourcing_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE energy_invitations ADD COLUMN revoked_at INTEGER;
DROP TRIGGER energy_offer_snapshot_update;
CREATE TRIGGER energy_offer_snapshot_update AFTER UPDATE OF revision ON energy_offers WHEN NEW.revision<>OLD.revision BEGIN
 INSERT INTO energy_offer_versions VALUES(lower(hex(randomblob(16))),NEW.id,NEW.case_id,NEW.revision,
 json_object('amount',NEW.amount,'currency',NEW.currency,'unit',NEW.unit,'terms',NEW.terms,'expires_at',NEW.expires_at,'total_minor',NEW.total_minor,'structured_terms',NEW.structured_terms),unixepoch()*1000);
END;
CREATE TRIGGER reserve_user_insert BEFORE INSERT ON users
WHEN NEW.role<>'owner' AND NEW.disabled_at IS NULL
 AND (SELECT workspace_kind FROM companies WHERE id=NEW.company_id)='customer'
 AND (SELECT COUNT(*) FROM users WHERE company_id=NEW.company_id AND disabled_at IS NULL)
 +(SELECT COUNT(*) FROM staff_invites WHERE company_id=NEW.company_id AND used_by IS NULL AND expires_at>unixepoch()*1000)>5
BEGIN SELECT RAISE(ABORT,'company seat limit reached'); END;
ALTER TABLE staff_invites ADD COLUMN invited_username TEXT;
UPDATE users SET can_request=0,can_offer=0,can_accept=0 WHERE role='viewer';
UPDATE users SET can_offer=0,can_accept=0 WHERE role='operator';
DROP TRIGGER invite_staff_authority;
CREATE TRIGGER invite_staff_authority AFTER INSERT ON users WHEN NEW.role<>'owner' BEGIN
 UPDATE users SET authority_status='staff',can_request=(NEW.role<>'viewer'),
 can_offer=(NEW.role='trader'),can_accept=(NEW.role='trader') WHERE id=NEW.id;
END;
