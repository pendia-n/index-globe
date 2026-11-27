ALTER TABLE energy_offers ADD COLUMN public_terms TEXT;
ALTER TABLE energy_offers ADD COLUMN normalized_total_minor INTEGER;
ALTER TABLE energy_offers ADD COLUMN normalized_by TEXT REFERENCES users(id);
ALTER TABLE energy_offers ADD COLUMN normalized_at INTEGER;
