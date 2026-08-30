import { Database } from 'bun:sqlite'
import { chmodSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { ContinuumError } from '../errors'
import { applyMigrations } from './migrations'

const databaseFileName = 'continuum.db'
const defaultBusyTimeoutMs = 5_000

export type ContinuumDataPaths = {
  dataDirectory: string
  databasePath: string
}

export type DataPathOptions = {
  dataDirectory?: string
  environment?: Record<string, string | undefined>
  homeDirectory?: string
}

export function resolveContinuumDataPaths(
  options: DataPathOptions = {},
): ContinuumDataPaths {
  const environment = options.environment ?? process.env
  const configuredDirectory =
    options.dataDirectory ?? environment.CONTINUUM_DATA_DIR
  const defaultDataHome = environment.XDG_DATA_HOME
    ? resolve(environment.XDG_DATA_HOME)
    : join(resolve(options.homeDirectory ?? homedir()), '.local', 'share')
  const dataDirectory = configuredDirectory
    ? resolve(configuredDirectory)
    : join(defaultDataHome, 'continuum')

  return {
    dataDirectory,
    databasePath: join(dataDirectory, databaseFileName),
  }
}

export function openContinuumDatabase(paths: ContinuumDataPaths): Database {
  try {
    validateDataPaths(paths)
    mkdirSync(paths.dataDirectory, { recursive: true, mode: 0o700 })
    makeUserPrivate(paths.dataDirectory, 0o700)

    const database = new Database(paths.databasePath, {
      create: true,
      strict: true,
    })

    try {
      database.exec(`PRAGMA busy_timeout = ${defaultBusyTimeoutMs}`)
      database.exec('PRAGMA foreign_keys = ON')
      database.exec('PRAGMA journal_mode = WAL')
      database.exec('PRAGMA synchronous = NORMAL')
      applyMigrations(database)
      makeUserPrivate(paths.databasePath, 0o600)
      makeUserPrivate(`${paths.databasePath}-wal`, 0o600)
      makeUserPrivate(`${paths.databasePath}-shm`, 0o600)
      return database
    } catch (cause) {
      database.close()
      throw cause
    }
  } catch (cause) {
    if (cause instanceof ContinuumError) throw cause
    throw new ContinuumError({
      code: 'DATABASE_ERROR',
      operation: 'open database',
      message: 'Failed to open the Continuum database.',
      context: { databasePath: paths.databasePath },
      cause,
    })
  }
}

function validateDataPaths(paths: ContinuumDataPaths): void {
  if (
    !isAbsolute(paths.dataDirectory) ||
    !isAbsolute(paths.databasePath) ||
    paths.databasePath !== join(paths.dataDirectory, databaseFileName)
  ) {
    throw new ContinuumError({
      code: 'DATABASE_ERROR',
      operation: 'open database',
      message: 'Continuum data paths must identify an absolute data directory.',
    })
  }

  if (
    existsSync(paths.dataDirectory) &&
    !statSync(paths.dataDirectory).isDirectory()
  ) {
    throw new ContinuumError({
      code: 'DATABASE_ERROR',
      operation: 'open database',
      message: 'The configured Continuum data directory is not a directory.',
      context: { dataDirectory: paths.dataDirectory },
    })
  }
}

function makeUserPrivate(path: string, mode: number): void {
  if (process.platform === 'win32' || !existsSync(path)) return
  chmodSync(path, mode)
}
