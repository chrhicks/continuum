CREATE TABLE memory_journal_entries (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT,
  source_project_id TEXT,
  source_session_id TEXT,
  idempotency_key TEXT UNIQUE,
  metadata TEXT NOT NULL DEFAULT '{}',
  payload_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_memory_journal_created_at ON memory_journal_entries(created_at);
--> statement-breakpoint
CREATE INDEX idx_memory_journal_kind ON memory_journal_entries(kind);
--> statement-breakpoint
CREATE INDEX idx_memory_journal_source ON memory_journal_entries(source);
--> statement-breakpoint
CREATE INDEX idx_memory_journal_source_session ON memory_journal_entries(source, source_session_id);
--> statement-breakpoint

CREATE TABLE memory_consolidations (
  id TEXT PRIMARY KEY,
  first_sequence INTEGER NOT NULL,
  last_sequence INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  summary TEXT,
  summary_version INTEGER NOT NULL DEFAULT 1,
  model TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (first_sequence > 0 AND last_sequence >= first_sequence)
);
--> statement-breakpoint
CREATE INDEX idx_memory_consolidations_boundary ON memory_consolidations(last_sequence);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_memory_consolidations_completed_range
  ON memory_consolidations(first_sequence, last_sequence) WHERE status = 'completed';
--> statement-breakpoint

CREATE TABLE memory_recall_sources (
  id TEXT PRIMARY KEY,
  harness TEXT NOT NULL,
  external_project_id TEXT,
  external_session_id TEXT NOT NULL,
  title TEXT,
  source_created_at TEXT,
  source_updated_at TEXT,
  fingerprint TEXT NOT NULL,
  first_ingested_at TEXT NOT NULL,
  last_ingested_at TEXT NOT NULL,
  UNIQUE (harness, external_session_id)
);
--> statement-breakpoint
CREATE INDEX idx_memory_recall_source_session ON memory_recall_sources(harness, external_session_id);
--> statement-breakpoint

CREATE TABLE memory_recall_messages (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES memory_recall_sources(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT,
  UNIQUE (source_id, ordinal)
);
--> statement-breakpoint
CREATE INDEX idx_memory_recall_messages_order ON memory_recall_messages(source_id, ordinal);
--> statement-breakpoint

CREATE TABLE memory_recall_summaries (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES memory_recall_sources(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  summary_version INTEGER NOT NULL DEFAULT 1,
  model TEXT,
  source_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_memory_recall_summaries_source ON memory_recall_summaries(source_id);
