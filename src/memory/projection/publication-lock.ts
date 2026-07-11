import { mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Effect } from 'effect'

const LOCK_NAME = '.projection.lock'
const LOCK_TIMEOUT_MS = 30_000
const STALE_LOCK_MS = 5 * 60_000
const retrySignal = new Int32Array(new SharedArrayBuffer(4))

export function withProjectionPublicationLock<A, E, R>(
  memoryDir: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | unknown, R> {
  const lockPath = join(memoryDir, LOCK_NAME)
  return Effect.acquireUseRelease(
    Effect.try({
      try: () => acquire(memoryDir, lockPath),
      catch: (cause) => cause,
    }),
    () => effect,
    () => Effect.sync(() => rmSync(lockPath, { recursive: true, force: true })),
  )
}

function acquire(memoryDir: string, lockPath: string): void {
  mkdirSync(memoryDir, { recursive: true })
  const deadline = Date.now() + LOCK_TIMEOUT_MS

  while (true) {
    try {
      mkdirSync(lockPath)
      break
    } catch (cause) {
      if (!isAlreadyExists(cause)) throw cause
      if (isStale(lockPath)) {
        rmSync(lockPath, { recursive: true, force: true })
        continue
      }
      if (Date.now() >= deadline)
        throw new Error(`Timed out waiting for projection lock: ${lockPath}`)
      Atomics.wait(retrySignal, 0, 0, 10)
    }
  }
}

function isAlreadyExists(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    cause.code === 'EEXIST'
  )
}

function isStale(path: string): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs > STALE_LOCK_MS
  } catch {
    return false
  }
}
