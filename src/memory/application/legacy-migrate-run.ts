import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { LEGACY_MIGRATION_VERSION } from './legacy-migrate-artifacts'
import type { LegacyArtifact } from './legacy-migrate-artifacts'

export function hasCompletedLegacyMigration(
  dbPath: string,
  sqlite?: Database,
): boolean {
  if (sqlite) return hasCompletedRun(sqlite)
  if (!existsSync(dbPath)) return false

  const readonly = new Database(dbPath, { readonly: true })
  try {
    return hasCompletedRun(readonly)
  } finally {
    readonly.close()
  }
}

export function hasCompletedRun(sqlite: Database): boolean {
  const table = sqlite
    .query(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_legacy_migration_runs'",
    )
    .get()
  if (!table) return false
  return Boolean(
    sqlite
      .query(
        `SELECT 1 FROM memory_legacy_migration_runs
         WHERE migration_version = ? AND status = 'completed' LIMIT 1`,
      )
      .get(LEGACY_MIGRATION_VERSION),
  )
}

export function recordCompletedRun(
  sqlite: Database,
  artifacts: readonly LegacyArtifact[],
): void {
  sqlite
    .query(
      `INSERT INTO memory_legacy_migration_runs
       (migration_version, status, artifact_count, imported_count, completed_at)
       VALUES (?, 'completed', ?, ?, ?)`,
    )
    .run(
      LEGACY_MIGRATION_VERSION,
      artifacts.length,
      artifacts.filter((artifact) => artifact.result === 'import').length,
      new Date().toISOString(),
    )
}
