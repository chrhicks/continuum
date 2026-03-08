CREATE TABLE IF NOT EXISTS memory_checkpoints (
  key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  scope TEXT NOT NULL,
  cursor TEXT,
  fingerprint TEXT,
  record_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_memory_checkpoints_source ON memory_checkpoints(source);
CREATE INDEX IF NOT EXISTS idx_memory_checkpoints_source_scope ON memory_checkpoints(source, scope);
