ALTER TABLE companies ADD COLUMN country TEXT;
ALTER TABLE companies ADD COLUMN registry_region TEXT;
ALTER TABLE companies ADD COLUMN registry_number TEXT;
CREATE UNIQUE INDEX company_registry_identity ON companies(country, registry_region, registry_number);

ALTER TABLE staff_invites ADD COLUMN invite_id TEXT;
UPDATE staff_invites SET invite_id=lower(hex(randomblob(16)));
CREATE UNIQUE INDEX invite_public_id ON staff_invites(invite_id);
CREATE INDEX invite_company_expiry ON staff_invites(company_id, expires_at);

CREATE TABLE tender_requests (
  request_id TEXT PRIMARY KEY REFERENCES requests(id),
  tender_id TEXT NOT NULL,
  source TEXT NOT NULL
);
CREATE INDEX tender_requests_group ON tender_requests(tender_id);

CREATE TABLE delivery_intervals (
  delivery_id TEXT PRIMARY KEY REFERENCES deliveries(id),
  readings_wh TEXT NOT NULL
);
