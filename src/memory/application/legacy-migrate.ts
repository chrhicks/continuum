import type { DbHandle } from '../../db/client'
import type { LegacyMigrationResult } from '../domain/legacy-migration'
import {
  inventoryLegacyArtifacts,
  planLegacyArtifacts,
} from './legacy-migrate-artifacts'
import { persistLegacyArtifacts } from './legacy-migrate-persist'
import { hasCompletedLegacyMigration } from './legacy-migrate-run'

export function migrateLegacyMemory(options: {
  workspaceRoot: string
  memoryDir: string
  dbPath: string
  dryRun: boolean
  handle?: DbHandle
}): LegacyMigrationResult {
  if (hasCompletedLegacyMigration(options.dbPath, options.handle?.sqlite))
    return { dryRun: options.dryRun, alreadyCompleted: true, items: [] }

  const artifacts = inventoryLegacyArtifacts(
    options.workspaceRoot,
    options.memoryDir,
  )
  const planned = planLegacyArtifacts(
    artifacts,
    options.dbPath,
    options.handle?.sqlite,
  )
  if (!options.dryRun) {
    if (!options.handle)
      throw new Error(
        'Legacy migration persistence requires a runtime DbHandle.',
      )
    // A completed boundary must never advance past an unconsolidated NOW row.
    const persistenceOrder = planned
      .slice()
      .sort(
        (left, right) =>
          Number(left.kind === 'now') - Number(right.kind === 'now'),
      )
    if (!persistLegacyArtifacts(options.handle, persistenceOrder))
      return { dryRun: false, alreadyCompleted: true, items: [] }
  }
  return { dryRun: options.dryRun, alreadyCompleted: false, items: planned }
}
