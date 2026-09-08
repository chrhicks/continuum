import { randomUUID } from 'node:crypto'
import {
  mkdirSync,
  readdirSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { Effect } from 'effect'

const LOCK_NAME = '.projection.lock'
const OWNER_PREFIX = '.owner-'
const LOCK_TIMEOUT_MS = 30_000
const STALE_LOCK_MS = 5 * 60_000
const retrySignal = new Int32Array(new SharedArrayBuffer(4))

export interface ProjectionLockLease {
  readonly lockPath: string
  readonly ownerPath: string
}

export interface ProjectionLockRuntime {
  readonly pid: number
  readonly timeoutMs: number
  readonly staleLockMs: number
  readonly now: () => number
  readonly createToken: () => string
  readonly isProcessAlive: (pid: number) => boolean
  readonly wait: (milliseconds: number) => void
}

const defaultRuntime: ProjectionLockRuntime = {
  pid: process.pid,
  timeoutMs: LOCK_TIMEOUT_MS,
  staleLockMs: STALE_LOCK_MS,
  now: Date.now,
  createToken: randomUUID,
  isProcessAlive,
  wait: (milliseconds) => {
    Atomics.wait(retrySignal, 0, 0, milliseconds)
  },
}

export function withProjectionPublicationLock<A, E, R>(
  memoryDir: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | unknown, R> {
  return Effect.acquireUseRelease(
    Effect.try({
      try: () => acquireProjectionPublicationLock(memoryDir),
      catch: (cause) => cause,
    }),
    () => effect,
    (lease) => Effect.sync(() => releaseProjectionPublicationLock(lease)),
  )
}

export function acquireProjectionPublicationLock(
  memoryDir: string,
  runtime: ProjectionLockRuntime = defaultRuntime,
): ProjectionLockLease {
  const lockPath = join(memoryDir, LOCK_NAME)
  const deadline = runtime.now() + runtime.timeoutMs
  mkdirSync(memoryDir, { recursive: true })

  while (true) {
    try {
      mkdirSync(lockPath)
      return createLease(lockPath, runtime)
    } catch (cause) {
      if (!isAlreadyExists(cause)) throw cause
      if (recoverAbandonedLock(lockPath, runtime)) continue
      if (runtime.now() >= deadline)
        throw new Error(`Timed out waiting for projection lock: ${lockPath}`)
      runtime.wait(10)
    }
  }
}

export function releaseProjectionPublicationLock(
  lease: ProjectionLockLease,
): void {
  rmSync(lease.ownerPath, { force: true })
  removeEmptyLock(lease.lockPath)
}

function createLease(
  lockPath: string,
  runtime: ProjectionLockRuntime,
): ProjectionLockLease {
  const ownerPath = join(
    lockPath,
    `${OWNER_PREFIX}${runtime.pid}-${runtime.createToken()}`,
  )
  try {
    writeFileSync(ownerPath, '', { flag: 'wx' })
    return { lockPath, ownerPath }
  } catch (cause) {
    removeEmptyLock(lockPath)
    throw cause
  }
}

function recoverAbandonedLock(
  lockPath: string,
  runtime: ProjectionLockRuntime,
): boolean {
  if (!isStale(lockPath, runtime)) return false
  const owners = readOwners(lockPath)
  if (owners === undefined) return false
  if (owners.some((owner) => runtime.isProcessAlive(owner.pid))) return false
  for (const owner of owners)
    rmSync(join(lockPath, owner.name), { force: true })
  return removeEmptyLock(lockPath)
}

function readOwners(
  lockPath: string,
): ReadonlyArray<{ name: string; pid: number }> | undefined {
  try {
    const entries = readdirSync(lockPath, { withFileTypes: true })
    const owners = entries.flatMap((entry) => {
      const match = entry.isFile()
        ? /^\.owner-(\d+)-.+$/.exec(entry.name)
        : null
      return match ? [{ name: entry.name, pid: Number(match[1]) }] : []
    })
    return owners.length === entries.length ? owners : undefined
  } catch {
    return undefined
  }
}

function removeEmptyLock(lockPath: string): boolean {
  try {
    rmdirSync(lockPath)
    return true
  } catch (cause) {
    if (hasCode(cause, 'ENOENT')) return true
    if (hasCode(cause, 'ENOTEMPTY')) return false
    throw cause
  }
}

function isAlreadyExists(cause: unknown): boolean {
  return hasCode(cause, 'EEXIST')
}

function hasCode(cause: unknown, code: string): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    cause.code === code
  )
}

function isStale(path: string, runtime: ProjectionLockRuntime): boolean {
  try {
    return runtime.now() - statSync(path).mtimeMs > runtime.staleLockMs
  } catch {
    return false
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return !hasCode(cause, 'ESRCH')
  }
}
