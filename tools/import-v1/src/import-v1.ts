import { existsSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import {
  ContinuumError,
  createContinuumImporter,
  resolveContinuumDataPaths,
} from '@continuum/core'
import { readValidatedLegacyRecords } from './legacy-source'

export type ImportV1Options = {
  source: string
  workspace: string
  dataDirectory?: string
}

export type ImportV1Result = {
  source: string
  workspace: string
  processed: number
}

export function importV1(options: ImportV1Options): ImportV1Result {
  const paths = validateImportPaths(options)
  const records = readValidatedLegacyRecords(paths.source)
  const importer = createContinuumImporter({
    dataDirectory: paths.dataDirectory,
  })
  let processed = 0
  let failure: unknown

  try {
    for (const record of records) {
      importer.importRecord({
        workspace: paths.workspace,
        id: record.id,
        kind: record.kind,
        content: record.content,
        tags: record.tags,
        createdAt: record.createdAt,
      })
      processed += 1
    }
  } catch (cause) {
    failure = cause
  }

  try {
    importer.close()
  } catch (cause) {
    failure ??= new ContinuumError({
      code: 'DATABASE_ERROR',
      operation: 'import v1',
      message: 'Failed to close the target Continuum database.',
      cause,
    })
  }

  if (failure) throw failure
  return {
    source: paths.source,
    workspace: paths.workspace,
    processed,
  }
}

function validateImportPaths(options: ImportV1Options): {
  source: string
  workspace: string
  dataDirectory: string
} {
  const source = requiredPath(options.source, 'source')
  const workspace = requiredPath(options.workspace, 'workspace')
  const dataDirectory =
    options.dataDirectory === undefined
      ? resolveContinuumDataPaths().dataDirectory
      : requiredPath(options.dataDirectory, 'dataDirectory')

  try {
    if (!statSync(source).isFile()) {
      throw pathValidationError(
        'The legacy source must be an existing regular file.',
        source,
        'source',
      )
    }
  } catch (cause) {
    if (cause instanceof ContinuumError) throw cause
    throw pathValidationError(
      'The legacy source must be an existing regular file.',
      source,
      'source',
    )
  }
  try {
    if (!statSync(workspace).isDirectory()) {
      throw pathValidationError(
        'The target workspace must be an existing directory.',
        source,
        'workspace',
      )
    }
  } catch (cause) {
    if (cause instanceof ContinuumError) throw cause
    throw pathValidationError(
      'The target workspace must be an existing directory.',
      source,
      'workspace',
    )
  }

  const targetDatabase = resolveContinuumDataPaths({
    dataDirectory,
  }).databasePath
  const sourceStat = statSync(source)
  const targetStat = existsSync(targetDatabase)
    ? statSync(targetDatabase)
    : undefined
  const sameFile =
    targetStat !== undefined &&
    sourceStat.dev === targetStat.dev &&
    sourceStat.ino === targetStat.ino
  if (
    sameFile ||
    realpathSync(source) === canonicalPotentialPath(targetDatabase)
  ) {
    throw pathValidationError(
      'The legacy source and target Continuum database must be different files.',
      source,
      'source',
    )
  }

  return { source, workspace, dataDirectory }
}

function requiredPath(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) {
    throw new ContinuumError({
      code: 'VALIDATION_ERROR',
      operation: 'import v1',
      message: 'Legacy import paths must not be empty.',
      context: { field },
    })
  }
  return resolve(value)
}

function canonicalPotentialPath(path: string): string {
  let existing = resolve(path)
  const missing: string[] = []
  while (!existsSync(existing)) {
    const parent = dirname(existing)
    if (parent === existing) break
    missing.unshift(basename(existing))
    existing = parent
  }
  return resolve(realpathSync(existing), ...missing)
}

function pathValidationError(
  message: string,
  sourcePath: string,
  field: string,
): ContinuumError {
  return new ContinuumError({
    code: 'VALIDATION_ERROR',
    operation: 'import v1',
    message,
    context: { sourcePath, field },
  })
}
