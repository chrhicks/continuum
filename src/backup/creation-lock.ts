import {
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import { canonicalDataHome } from '../db/paths'
import { currentDate, randomUuid } from './authority'
import { BackupCreationConflict, causeMessage } from './errors'

const LOCK_VERSION = 1
const LOCK_DIRECTORY = 'backup-locks'
const LockOwnerSchema = Schema.Struct({
  version: Schema.Literal(LOCK_VERSION),
  token: Schema.NonEmptyString,
  pid: Schema.Int,
  hostname: Schema.NonEmptyString,
  createdAt: Schema.String,
})

interface LockOwner extends Schema.Schema.Type<typeof LockOwnerSchema> {}

type HeldLock = {
  path: string
  token: string
}

export function withBackupCreationLock<A, E, R>(
  projectId: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | BackupCreationConflict, R> {
  return Effect.gen(function* () {
    const token = yield* randomUuid()
    const now = yield* currentDate
    const owner: LockOwner = {
      version: LOCK_VERSION,
      token,
      pid: process.pid,
      hostname: hostname(),
      createdAt: now.toISOString(),
    }
    return yield* Effect.acquireUseRelease(
      acquireLock(projectId, owner),
      () => effect,
      releaseLock,
    )
  })
}

function acquireLock(
  projectId: string,
  owner: LockOwner,
): Effect.Effect<HeldLock, BackupCreationConflict> {
  return Effect.try({
    try: () => acquireLockFile(projectId, owner),
    catch: (cause) =>
      cause instanceof BackupCreationConflict
        ? cause
        : creationConflict(
            projectId,
            `Unable to acquire the local backup creation lock: ${causeMessage(cause)}`,
            cause,
          ),
  })
}

function acquireLockFile(projectId: string, owner: LockOwner): HeldLock {
  const directory = join(canonicalDataHome(), 'continuum', LOCK_DIRECTORY)
  const path = join(directory, `${projectId}.lock`)
  const staging = join(directory, `.${projectId}.${owner.token}.tmp`)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  try {
    writeFileSync(staging, `${JSON.stringify(owner, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    })
    try {
      linkSync(staging, path)
    } catch (cause) {
      if (isAlreadyExists(cause)) {
        throw creationConflict(
          projectId,
          'Another local backup creation is already active. If its process was interrupted, follow the documented lock recovery procedure.',
        )
      }
      throw cause
    }
    return { path, token: owner.token }
  } finally {
    rmSync(staging, { force: true })
  }
}

function releaseLock(
  lock: HeldLock,
): Effect.Effect<void, BackupCreationConflict> {
  return Effect.try({
    try: () => {
      const owner = readLockOwner(lock.path)
      if (owner.token !== lock.token) {
        throw new Error('lock ownership changed before release')
      }
      rmSync(lock.path)
    },
    catch: (cause) =>
      new BackupCreationConflict({
        code: 'BACKUP_CREATION_CONFLICT',
        message: `Unable to release the local backup creation lock: ${causeMessage(cause)}`,
        cause,
      }),
  })
}

function readLockOwner(path: string): LockOwner {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  const owner = Schema.decodeUnknownSync(LockOwnerSchema)(value)
  if (owner.pid < 1) throw new Error('lock owner PID must be positive')
  return owner
}

function creationConflict(
  projectId: string,
  message: string,
  cause?: unknown,
): BackupCreationConflict {
  return new BackupCreationConflict({
    code: 'BACKUP_CREATION_CONFLICT',
    message: `${message} Project: ${projectId}`,
    ...(cause === undefined ? {} : { cause }),
  })
}

function isAlreadyExists(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    cause.code === 'EEXIST'
  )
}
