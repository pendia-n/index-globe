CREATE TABLE bunker_documents (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES bunker_orders(id),
  category TEXT NOT NULL CHECK(category IN ('agreement','nomination','delivery-note','quantity','quality','invoice','payment')),
  filename TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 393216),
  content BLOB NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  uploaded_at INTEGER NOT NULL,
  UNIQUE(order_id,category,sha256)
);
CREATE INDEX bunker_documents_order ON bunker_documents(order_id,uploaded_at);
