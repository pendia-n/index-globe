ALTER TABLE solar_offers RENAME TO power_offers;
ALTER TABLE power_offers ADD COLUMN source TEXT NOT NULL DEFAULT 'solar'
  CHECK (source IN ('solar','wind','hydro','geothermal','biomass','nuclear','gas','other'));
CREATE INDEX power_offers_source ON power_offers (source, status, created_at DESC);
