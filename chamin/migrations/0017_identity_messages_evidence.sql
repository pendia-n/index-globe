ALTER TABLE users ADD COLUMN authority_status TEXT NOT NULL DEFAULT 'applicant' CHECK(authority_status IN ('applicant','verified','staff'));
ALTER TABLE users ADD COLUMN authority_until INTEGER;
ALTER TABLE users ADD COLUMN can_request INTEGER NOT NULL DEFAULT 1 CHECK(can_request IN (0,1));
ALTER TABLE users ADD COLUMN can_offer INTEGER NOT NULL DEFAULT 1 CHECK(can_offer IN (0,1));
ALTER TABLE users ADD COLUMN can_accept INTEGER NOT NULL DEFAULT 1 CHECK(can_accept IN (0,1));
UPDATE users SET authority_status='verified' WHERE company_id IN (SELECT id FROM companies WHERE status='approved' OR workspace_kind='operations');
UPDATE users SET authority_status='staff' WHERE role<>'owner';
CREATE TABLE reserved_usernames (username TEXT PRIMARY KEY);
INSERT INTO reserved_usernames VALUES('malka');
ALTER TABLE company_applications ADD COLUMN applicant_name TEXT;
ALTER TABLE company_applications ADD COLUMN position TEXT;
ALTER TABLE company_applications ADD COLUMN registered_address TEXT;
ALTER TABLE company_applications ADD COLUMN officer_name TEXT;
ALTER TABLE company_applications ADD COLUMN officer_contact TEXT;
ALTER TABLE company_applications ADD COLUMN permission_scope TEXT;
ALTER TABLE company_applications ADD COLUMN authority_limit TEXT;
ALTER TABLE company_applications ADD COLUMN authority_until INTEGER;
ALTER TABLE company_applications ADD COLUMN clarification TEXT;
ALTER TABLE company_applications ADD COLUMN check_record TEXT;
ALTER TABLE company_applications ADD COLUMN updated_at INTEGER;
CREATE TABLE application_updates (
 id TEXT PRIMARY KEY,application_id TEXT NOT NULL REFERENCES company_applications(id),actor_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL
);
CREATE TABLE company_join_requests (
 id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),applicant_id TEXT NOT NULL REFERENCES users(id),
 note TEXT NOT NULL,created_at INTEGER NOT NULL,decision TEXT,decided_by TEXT REFERENCES users(id),decided_at INTEGER,
 UNIQUE(company_id,applicant_id)
);
CREATE TABLE dm_conversations (
 id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('support','trade')),context_kind TEXT CHECK(context_kind IN ('energy','bunker','power')),
 context_id TEXT,user_a TEXT NOT NULL REFERENCES users(id),user_b TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 CHECK(user_a<>user_b)
);
CREATE UNIQUE INDEX dm_support_pair ON dm_conversations(user_a) WHERE kind='support';
CREATE UNIQUE INDEX dm_trade_pair ON dm_conversations(context_kind,context_id,user_a,user_b) WHERE kind='trade';
CREATE TABLE dm_messages (
 id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES dm_conversations(id),sender_id TEXT NOT NULL REFERENCES users(id),
 body TEXT NOT NULL,created_at INTEGER NOT NULL,request_key TEXT NOT NULL UNIQUE
);
CREATE INDEX dm_message_order ON dm_messages(conversation_id,created_at,id);
CREATE TABLE dm_reads (conversation_id TEXT NOT NULL REFERENCES dm_conversations(id),user_id TEXT NOT NULL REFERENCES users(id),last_read_at INTEGER NOT NULL,PRIMARY KEY(conversation_id,user_id));
CREATE TABLE private_documents (
 id TEXT PRIMARY KEY,scope TEXT NOT NULL CHECK(scope IN ('company','dm','energy')),scope_id TEXT NOT NULL,category TEXT NOT NULL,
 filename TEXT NOT NULL,mime TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 1048576),content BLOB NOT NULL,
 uploaded_by TEXT NOT NULL REFERENCES users(id),uploaded_at INTEGER NOT NULL,UNIQUE(scope,scope_id,category,sha256)
);
CREATE INDEX private_documents_scope ON private_documents(scope,scope_id,uploaded_at);
CREATE TABLE application_documents (application_id TEXT NOT NULL REFERENCES company_applications(id),document_id TEXT NOT NULL REFERENCES private_documents(id),PRIMARY KEY(application_id,document_id));
CREATE TABLE dm_attachments (message_id TEXT NOT NULL REFERENCES dm_messages(id),document_id TEXT NOT NULL REFERENCES private_documents(id),PRIMARY KEY(message_id,document_id));
CREATE TABLE dm_reports (id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES dm_conversations(id),reported_by TEXT NOT NULL REFERENCES users(id),reason TEXT NOT NULL,created_at INTEGER NOT NULL,resolved_at INTEGER,resolution TEXT);
CREATE TRIGGER dm_bump_conversation AFTER INSERT ON dm_messages BEGIN
 UPDATE dm_conversations SET updated_at=NEW.created_at WHERE id=NEW.conversation_id;
END;
-- Database-level capacity rules cover parallel requests and manual integrations.
CREATE TRIGGER enforce_company_user_capacity BEFORE INSERT ON users
WHEN (SELECT workspace_kind FROM companies WHERE id=NEW.company_id)='customer'
 AND (SELECT COUNT(*) FROM users WHERE company_id=NEW.company_id AND disabled_at IS NULL)>=5
BEGIN SELECT RAISE(ABORT,'company seat limit reached'); END;
CREATE TRIGGER enforce_company_invite_capacity BEFORE INSERT ON staff_invites
WHEN NEW.used_by IS NULL AND NEW.expires_at>unixepoch()*1000
 AND ((SELECT COUNT(*) FROM users WHERE company_id=NEW.company_id AND disabled_at IS NULL)
 +(SELECT COUNT(*) FROM staff_invites WHERE company_id=NEW.company_id AND used_by IS NULL AND expires_at>unixepoch()*1000))>=5
BEGIN SELECT RAISE(ABORT,'company seat limit reached'); END;
CREATE TRIGGER enforce_company_restore_capacity BEFORE UPDATE OF disabled_at ON users
WHEN OLD.disabled_at IS NOT NULL AND NEW.disabled_at IS NULL
 AND (SELECT workspace_kind FROM companies WHERE id=NEW.company_id)='customer'
 AND ((SELECT COUNT(*) FROM users WHERE company_id=NEW.company_id AND disabled_at IS NULL)
 +(SELECT COUNT(*) FROM staff_invites WHERE company_id=NEW.company_id AND used_by IS NULL AND expires_at>unixepoch()*1000))>=5
BEGIN SELECT RAISE(ABORT,'company seat limit reached'); END;
