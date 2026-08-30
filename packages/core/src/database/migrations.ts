import type { Database } from 'bun:sqlite'
import { ContinuumError } from '../errors'

const migrations = [
  {
    version: 1,
    name: 'canonical memory tables',
    sql: `
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        identity_kind TEXT NOT NULL CHECK (identity_kind IN ('git', 'path')),
        identity_value TEXT NOT NULL CHECK (length(identity_value) > 0),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        UNIQUE (identity_kind, identity_value)
      );

      CREATE TABLE workspace_aliases (
        kind TEXT NOT NULL CHECK (kind IN ('git', 'path')),
        value TEXT NOT NULL CHECK (length(value) > 0),
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        PRIMARY KEY (kind, value)
      );

      CREATE INDEX workspace_aliases_workspace_idx
        ON workspace_aliases(workspace_id);

      CREATE TABLE memory_records (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        kind TEXT NOT NULL CHECK (
          length(kind) > 0 AND kind = lower(trim(kind))
        ),
        content TEXT NOT NULL CHECK (length(trim(content)) > 0),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0)
      );

      CREATE INDEX memory_records_workspace_created_idx
        ON memory_records(workspace_id, created_at DESC, id DESC);

      CREATE TABLE memory_record_tags (
        record_rowid INTEGER NOT NULL REFERENCES memory_records(rowid),
        tag TEXT NOT NULL CHECK (
          length(tag) > 0 AND tag = lower(trim(tag))
        ),
        PRIMARY KEY (record_rowid, tag)
      );

      CREATE INDEX memory_record_tags_tag_idx
        ON memory_record_tags(tag, record_rowid);

      CREATE TABLE memory_supersessions (
        record_rowid INTEGER NOT NULL REFERENCES memory_records(rowid),
        superseded_record_rowid INTEGER NOT NULL REFERENCES memory_records(rowid),
        PRIMARY KEY (record_rowid, superseded_record_rowid),
        CHECK (record_rowid <> superseded_record_rowid)
      );

      CREATE INDEX memory_supersessions_superseded_idx
        ON memory_supersessions(superseded_record_rowid);

      CREATE TRIGGER memory_records_no_update
      BEFORE UPDATE ON memory_records
      BEGIN
        SELECT RAISE(ABORT, 'memory records are immutable');
      END;

      CREATE TRIGGER memory_records_no_delete
      BEFORE DELETE ON memory_records
      BEGIN
        SELECT RAISE(ABORT, 'memory records are immutable');
      END;

      CREATE TRIGGER memory_record_tags_no_update
      BEFORE UPDATE ON memory_record_tags
      BEGIN
        SELECT RAISE(ABORT, 'memory record tags are immutable');
      END;

      CREATE TRIGGER memory_record_tags_no_delete
      BEFORE DELETE ON memory_record_tags
      BEGIN
        SELECT RAISE(ABORT, 'memory record tags are immutable');
      END;

      CREATE TRIGGER memory_supersessions_no_update
      BEFORE UPDATE ON memory_supersessions
      BEGIN
        SELECT RAISE(ABORT, 'memory supersessions are immutable');
      END;

      CREATE TRIGGER memory_supersessions_no_delete
      BEFORE DELETE ON memory_supersessions
      BEGIN
        SELECT RAISE(ABORT, 'memory supersessions are immutable');
      END;
    `,
  },
  {
    version: 2,
    name: 'memory full text index',
    sql: `
      CREATE VIRTUAL TABLE memory_fts USING fts5(
        content,
        kind,
        tags,
        tokenize = 'unicode61'
      );
    `,
  },
  {
    version: 3,
    name: 'backfill memory full text index',
    sql: `
      INSERT INTO memory_fts (rowid, content, kind, tags)
      SELECT
        r.rowid,
        r.content,
        r.kind,
        COALESCE((
          SELECT group_concat(tag, ' ')
          FROM (
            SELECT tag
            FROM memory_record_tags
            WHERE record_rowid = r.rowid
            ORDER BY tag
          )
        ), '')
      FROM memory_records r
      WHERE NOT EXISTS (
        SELECT 1 FROM memory_fts
        WHERE memory_fts.rowid = r.rowid
      );
    `,
  },
] as const

export const latestSchemaVersion = migrations.at(-1)?.version ?? 0

export function applyMigrations(database: Database): void {
  const currentVersion = readSchemaVersion(database)
  if (currentVersion > latestSchemaVersion) {
    throw new ContinuumError({
      code: 'DATABASE_ERROR',
      operation: 'migrate database',
      message: `Database schema version ${currentVersion} is newer than supported version ${latestSchemaVersion}.`,
    })
  }

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue

    let transactionStarted = false
    try {
      database.exec('BEGIN IMMEDIATE')
      transactionStarted = true
      database.exec(migration.sql)
      database.exec(`PRAGMA user_version = ${migration.version}`)
      database.exec('COMMIT')
    } catch (cause) {
      if (transactionStarted) database.exec('ROLLBACK')
      throw new ContinuumError({
        code: 'DATABASE_ERROR',
        operation: 'migrate database',
        message: `Failed to apply migration ${migration.version}: ${migration.name}.`,
        cause,
      })
    }
  }
}

function readSchemaVersion(database: Database): number {
  const row = database.query('PRAGMA user_version').get() as {
    user_version: number
  }
  return row.user_version
}
