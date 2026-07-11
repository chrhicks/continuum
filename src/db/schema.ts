import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core'

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull().default('open'),
    priority: integer('priority').notNull().default(100),
    intent: text('intent'),
    description: text('description'),
    plan: text('plan'),
    steps: text('steps').notNull().default('[]'),
    current_step: integer('current_step'),
    discoveries: text('discoveries').notNull().default('[]'),
    decisions: text('decisions').notNull().default('[]'),
    outcome: text('outcome'),
    completed_at: text('completed_at'),
    parent_id: text('parent_id'),
    blocked_by: text('blocked_by').notNull().default('[]'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.parent_id],
      foreignColumns: [table.id],
    }).onDelete('set null'),
    index('idx_tasks_status').on(table.status),
    index('idx_tasks_parent').on(table.parent_id),
    index('idx_tasks_priority').on(table.priority),
  ],
)

export const memoryCheckpoints = sqliteTable(
  'memory_checkpoints',
  {
    key: text('key').primaryKey(),
    source: text('source').notNull(),
    scope: text('scope').notNull(),
    cursor: text('cursor'),
    fingerprint: text('fingerprint'),
    record_count: integer('record_count').notNull().default(0),
    updated_at: text('updated_at').notNull(),
    metadata: text('metadata').notNull().default('{}'),
  },
  (table) => [
    index('idx_memory_checkpoints_source').on(table.source),
    index('idx_memory_checkpoints_source_scope').on(table.source, table.scope),
  ],
)

export const memoryJournalEntries = sqliteTable(
  'memory_journal_entries',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    kind: text('kind').notNull(),
    content: text('content').notNull(),
    source: text('source'),
    source_project_id: text('source_project_id'),
    source_session_id: text('source_session_id'),
    idempotency_key: text('idempotency_key').unique(),
    metadata: text('metadata').notNull().default('{}'),
    payload_version: integer('payload_version').notNull().default(1),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    index('idx_memory_journal_created_at').on(table.created_at),
    index('idx_memory_journal_kind').on(table.kind),
    index('idx_memory_journal_source').on(table.source),
    index('idx_memory_journal_source_session').on(
      table.source,
      table.source_session_id,
    ),
  ],
)

export const memoryConsolidations = sqliteTable(
  'memory_consolidations',
  {
    id: text('id').primaryKey(),
    first_sequence: integer('first_sequence').notNull(),
    last_sequence: integer('last_sequence').notNull(),
    status: text('status').notNull(),
    summary: text('summary'),
    summary_version: integer('summary_version').notNull().default(1),
    model: text('model'),
    error: text('error'),
    created_at: text('created_at').notNull(),
    completed_at: text('completed_at'),
  },
  (table) => [
    index('idx_memory_consolidations_boundary').on(table.last_sequence),
  ],
)

export const memoryRecallSources = sqliteTable(
  'memory_recall_sources',
  {
    id: text('id').primaryKey(),
    harness: text('harness').notNull(),
    external_project_id: text('external_project_id'),
    external_session_id: text('external_session_id').notNull(),
    title: text('title'),
    source_created_at: text('source_created_at'),
    source_updated_at: text('source_updated_at'),
    fingerprint: text('fingerprint').notNull(),
    first_ingested_at: text('first_ingested_at').notNull(),
    last_ingested_at: text('last_ingested_at').notNull(),
  },
  (table) => [
    unique('memory_recall_sources_harness_session_unique').on(
      table.harness,
      table.external_session_id,
    ),
    index('idx_memory_recall_source_session').on(
      table.harness,
      table.external_session_id,
    ),
  ],
)

export const memoryRecallMessages = sqliteTable(
  'memory_recall_messages',
  {
    id: text('id').primaryKey(),
    source_id: text('source_id')
      .notNull()
      .references(() => memoryRecallSources.id, { onDelete: 'cascade' }),
    source_fingerprint: text('source_fingerprint').notNull(),
    ordinal: integer('ordinal').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    created_at: text('created_at'),
  },
  (table) => [
    index('idx_memory_recall_messages_order').on(
      table.source_id,
      table.source_fingerprint,
      table.ordinal,
    ),
  ],
)

export const memoryRecallSummaries = sqliteTable(
  'memory_recall_summaries',
  {
    id: text('id').primaryKey(),
    source_id: text('source_id')
      .notNull()
      .references(() => memoryRecallSources.id, { onDelete: 'cascade' }),
    summary: text('summary').notNull(),
    summary_version: integer('summary_version').notNull().default(1),
    model: text('model'),
    source_fingerprint: text('source_fingerprint').notNull(),
    created_at: text('created_at').notNull(),
  },
  (table) => [index('idx_memory_recall_summaries_source').on(table.source_id)],
)

export const memoryLegacyMigrations = sqliteTable(
  'memory_legacy_migrations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    source_path: text('source_path').notNull(),
    checksum: text('checksum').notNull(),
    migration_version: integer('migration_version').notNull(),
    artifact_kind: text('artifact_kind').notNull(),
    import_result: text('import_result').notNull(),
    canonical_id: text('canonical_id'),
    detail: text('detail'),
    imported_at: text('imported_at').notNull(),
  },
  (table) => [
    index('idx_memory_legacy_migrations_source').on(
      table.source_path,
      table.migration_version,
    ),
  ],
)

export const memoryLegacyMigrationRuns = sqliteTable(
  'memory_legacy_migration_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    migration_version: integer('migration_version').notNull(),
    status: text('status').notNull(),
    artifact_count: integer('artifact_count').notNull(),
    imported_count: integer('imported_count').notNull(),
    completed_at: text('completed_at').notNull(),
  },
  (table) => [
    index('idx_memory_legacy_migration_runs_version').on(
      table.migration_version,
      table.completed_at,
    ),
  ],
)
