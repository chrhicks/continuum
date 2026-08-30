import type { Database } from 'bun:sqlite'
import {
  openContinuumDatabase,
  resolveContinuumDataPaths,
  type DataPathOptions,
} from './database/database'
import {
  prepareImportedMemoryRecord,
  prepareMemoryRecord,
  writeMemoryRecord,
  type ImportMemoryRecordInput,
  type MemoryRecord,
  type RecordMemoryInput,
} from './memory/records'
import { resolveWorkspace, type WorkspaceInfo } from './workspaces/workspaces'

export type Continuum = {
  resolveWorkspace(workspacePath: string): WorkspaceInfo
  record(input: RecordMemoryInput): MemoryRecord
  close(): void
}

export type ContinuumImporter = {
  importRecord(input: ImportMemoryRecordInput): MemoryRecord
  close(): void
}

export function createContinuum(options: DataPathOptions = {}): Continuum {
  const database = ownDatabase(options)
  return {
    resolveWorkspace(workspacePath) {
      const workspace = resolveWorkspace(database.get(), workspacePath)
      return { identity: workspace.identity, aliases: workspace.aliases }
    },
    record(input) {
      const prepared = prepareMemoryRecord(input)
      return writeMemoryRecord(database.get(), prepared)
    },
    close: database.close,
  }
}

export function createContinuumImporter(
  options: DataPathOptions = {},
): ContinuumImporter {
  const database = ownDatabase(options)
  return {
    importRecord(input) {
      const prepared = prepareImportedMemoryRecord(input)
      return writeMemoryRecord(database.get(), prepared)
    },
    close: database.close,
  }
}

function ownDatabase(options: DataPathOptions): {
  get(): Database
  close(): void
} {
  const paths = resolveContinuumDataPaths(options)
  let database: Database | undefined

  return {
    get() {
      database ??= openContinuumDatabase(paths)
      return database
    },
    close() {
      database?.close()
      database = undefined
    },
  }
}
