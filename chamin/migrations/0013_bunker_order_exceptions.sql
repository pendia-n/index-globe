ALTER TABLE bunker_fulfilment ADD COLUMN nomination_eta INTEGER;
ALTER TABLE bunker_fulfilment ADD COLUMN delay_note TEXT;
ALTER TABLE bunker_fulfilment ADD COLUMN cancellation_side TEXT CHECK(cancellation_side IN ('buyer','supplier'));
ALTER TABLE bunker_fulfilment ADD COLUMN cancellation_note TEXT;
ALTER TABLE bunker_fulfilment ADD COLUMN cancelled_at INTEGER;
