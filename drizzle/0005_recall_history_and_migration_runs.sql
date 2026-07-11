ALTER TABLE memory_recall_messages RENAME TO memory_recall_messages_legacy;
--> statement-breakpoint
CREATE TABLE memory_recall_messages (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES memory_recall_sources(id) ON DELETE CASCADE,
  source_fingerprint TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT,
  UNIQUE (source_id, source_fingerprint, ordinal)
);
--> statement-breakpoint
INSERT INTO memory_recall_messages
  (id, source_id, source_fingerprint, ordinal, role, content, created_at)
SELECT m.id, m.source_id, s.fingerprint, m.ordinal, m.role, m.content, m.created_at
FROM memory_recall_messages_legacy m
JOIN memory_recall_sources s ON s.id = m.source_id;
--> statement-breakpoint
DROP TABLE memory_recall_messages_legacy;
--> statement-breakpoint
CREATE INDEX idx_memory_recall_messages_order
  ON memory_recall_messages(source_id, source_fingerprint, ordinal);
--> statement-breakpoint
CREATE TABLE memory_legacy_migration_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  migration_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed')),
  artifact_count INTEGER NOT NULL,
  imported_count INTEGER NOT NULL,
  completed_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_memory_legacy_migration_runs_version
  ON memory_legacy_migration_runs(migration_version, completed_at);
