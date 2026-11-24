ALTER TABLE bunker_enquiries ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bunker_enquiries ADD COLUMN cancelled_at INTEGER;
ALTER TABLE bunker_enquiries ADD COLUMN cancellation_note TEXT;
ALTER TABLE bunker_quotes ADD COLUMN enquiry_revision INTEGER NOT NULL DEFAULT 1;

CREATE TABLE bunker_request_changes (
  id TEXT PRIMARY KEY,
  enquiry_id TEXT NOT NULL REFERENCES bunker_enquiries(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  event TEXT NOT NULL CHECK(event IN ('revised','cancelled')),
  enquiry_revision INTEGER NOT NULL,
  previous_terms TEXT,
  reason TEXT NOT NULL,
  occurred_at INTEGER NOT NULL
);
CREATE INDEX bunker_request_changes_order ON bunker_request_changes(enquiry_id,occurred_at DESC);
