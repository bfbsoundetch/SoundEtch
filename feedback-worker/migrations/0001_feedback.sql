CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  message TEXT NOT NULL,
  logs TEXT NOT NULL DEFAULT ''
);
CREATE INDEX feedback_created_at ON feedback(created_at);
CREATE INDEX feedback_ip_created_at ON feedback(ip_hash, created_at);
