ALTER TABLE companies ADD COLUMN workspace_kind TEXT NOT NULL DEFAULT 'customer' CHECK(workspace_kind IN ('customer','operations'));
ALTER TABLE companies ADD COLUMN issuing_registry TEXT;

CREATE TABLE bunker_operator_invites (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_by TEXT REFERENCES users(id)
);

CREATE TABLE bunker_operator_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK(action IN ('activated','revoked')),
  occurred_at INTEGER NOT NULL
);

CREATE TABLE company_applications (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  contact_email TEXT NOT NULL,
  registry_reference TEXT NOT NULL,
  authority_reference TEXT NOT NULL,
  submitted_by TEXT NOT NULL REFERENCES users(id),
  submitted_at INTEGER NOT NULL,
  decision TEXT CHECK(decision IN ('approved','rejected')),
  decision_note TEXT,
  decided_by TEXT REFERENCES users(id),
  decided_at INTEGER
);
CREATE UNIQUE INDEX company_one_open_application ON company_applications(company_id) WHERE decision IS NULL;
CREATE INDEX company_application_history ON company_applications(company_id,submitted_at DESC);

CREATE TRIGGER bunker_finish_operator_revocation
AFTER UPDATE OF revoked_at ON bunker_operators
WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
BEGIN
  INSERT INTO bunker_operator_events VALUES (lower(hex(randomblob(16))),NEW.user_id,'revoked',NEW.revoked_at);
  DELETE FROM sessions WHERE user_id=NEW.user_id;
END;
