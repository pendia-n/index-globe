CREATE TABLE bunker_fulfilment (
  order_id TEXT PRIMARY KEY REFERENCES bunker_orders(id),
  revision INTEGER NOT NULL DEFAULT 0,
  nomination TEXT,
  delivery_ref TEXT,
  meter_ref TEXT,
  quality_ref TEXT,
  delivered_kg INTEGER,
  delivery_state TEXT CHECK(delivery_state IN ('reported','disputed','accepted')),
  delivery_note TEXT,
  invoice_ref TEXT,
  invoice_cents INTEGER,
  due_at INTEGER,
  confirmed_cents INTEGER NOT NULL DEFAULT 0,
  payment_ref TEXT,
  payment_cents INTEGER,
  payment_state TEXT CHECK(payment_state IN ('reported','disputed','received')),
  payment_note TEXT,
  closed_at INTEGER
);

CREATE TABLE bunker_fulfilment_events (
  order_id TEXT NOT NULL REFERENCES bunker_fulfilment(order_id),
  revision INTEGER NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  event TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(order_id,revision)
);

INSERT INTO bunker_fulfilment(order_id) SELECT id FROM bunker_orders WHERE status='confirmed';

CREATE TRIGGER bunker_start_fulfilment
AFTER UPDATE OF status ON bunker_orders
WHEN NEW.status='confirmed' AND OLD.status<>'confirmed'
BEGIN
  INSERT INTO bunker_fulfilment(order_id) VALUES (NEW.id);
END;

CREATE TABLE bunker_received_payments (
  order_id TEXT NOT NULL REFERENCES bunker_orders(id),
  reference TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  PRIMARY KEY(order_id,reference)
);

CREATE TRIGGER bunker_record_received_payment
AFTER UPDATE OF payment_state ON bunker_fulfilment
WHEN NEW.payment_state='received' AND OLD.payment_state='reported'
BEGIN
  INSERT INTO bunker_received_payments VALUES (NEW.order_id,NEW.payment_ref,NEW.payment_cents);
END;
