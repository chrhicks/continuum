CREATE TABLE memory_legacy_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_path TEXT NOT NULL,
  checksum TEXT NOT NULL,
  migration_version INTEGER NOT NULL,
  artifact_kind TEXT NOT NULL,
  import_result TEXT NOT NULL,
  canonical_id TEXT,
  detail TEXT,
  imported_at TEXT NOT NULL,
  UNIQUE (source_path, checksum, migration_version)
);
--> statement-breakpoint
CREATE INDEX idx_memory_legacy_migrations_source
  ON memory_legacy_migrations(source_path, migration_version);
