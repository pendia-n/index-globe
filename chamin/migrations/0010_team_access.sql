ALTER TABLE users ADD COLUMN disabled_at INTEGER;

CREATE TABLE team_access_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  member_id TEXT NOT NULL REFERENCES users(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  role TEXT,
  occurred_at INTEGER NOT NULL
);
CREATE INDEX team_access_events_company ON team_access_events(company_id,occurred_at DESC);

CREATE TABLE team_transfers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  next_owner_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  finished_at INTEGER,
  outcome TEXT CHECK(outcome IN ('accepted','cancelled'))
);
CREATE UNIQUE INDEX team_one_open_transfer ON team_transfers(company_id) WHERE finished_at IS NULL;

CREATE TRIGGER team_revoke_disabled_sessions
AFTER UPDATE OF disabled_at ON users WHEN NEW.disabled_at IS NOT NULL AND OLD.disabled_at IS NULL
BEGIN
  DELETE FROM sessions WHERE user_id=NEW.id;
END;

CREATE TRIGGER team_apply_accepted_transfer
AFTER UPDATE OF outcome ON team_transfers WHEN NEW.outcome='accepted' AND OLD.outcome IS NULL
BEGIN
  UPDATE users SET role='trader' WHERE id=NEW.owner_id;
  UPDATE users SET role='owner' WHERE id=NEW.next_owner_id;
  DELETE FROM sessions WHERE user_id IN (NEW.owner_id,NEW.next_owner_id);
  UPDATE staff_invites SET expires_at=NEW.finished_at WHERE company_id=NEW.company_id AND used_by IS NULL AND expires_at>NEW.finished_at;
  INSERT INTO team_access_events VALUES (lower(hex(randomblob(16))),NEW.company_id,NEW.next_owner_id,NEW.next_owner_id,'ownership accepted','owner',NEW.finished_at);
END;
