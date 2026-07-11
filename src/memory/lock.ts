import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { ensureMemoryDir, memoryPath } from './paths'

export type MemoryLockOptions = {
  retries?: number
  retryDelayMs?: number
  staleLockMs?: number
}

const DEFAULT_RETRIES = 5
const DEFAULT_RETRY_DELAY_MS = 200
const DEFAULT_STALE_LOCK_MS = 60_000

type LockOwner = {
  pid: number
  timestamp: string
  token: string
}

export class MemoryLockError extends Error {}

export function getMemoryLockPath(): string {
  return memoryPath('.memory.lock')
}

export function withMemoryLock<T>(
  action: () => T,
  options: MemoryLockOptions = {},
): T {
  ensureMemoryDir()
  const owner = acquireLockSync(getMemoryLockPath(), options)
  try {
    return action()
  } finally {
    releaseLock(getMemoryLockPath(), owner)
  }
}

export async function withMemoryLockAsync<T>(
  action: () => Promise<T>,
  options: MemoryLockOptions = {},
): Promise<T> {
  return withFileLockAsync(getMemoryLockPath(), action, options)
}

export async function withFileLockAsync<T>(
  lockPath: string,
  action: () => Promise<T>,
  options: MemoryLockOptions = {},
): Promise<T> {
  ensureMemoryDir()
  const owner = await acquireLockAsync(lockPath, options)
  try {
    return await action()
  } finally {
    releaseLock(lockPath, owner)
  }
}

function acquireLockSync(
  lockPath: string,
  options: MemoryLockOptions,
): LockOwner {
  const { retries, retryDelayMs, staleLockMs } = resolveOptions(options)

  for (let attempt = 0; attempt < retries; attempt += 1) {
    const owner = tryAcquireLock(lockPath)
    if (owner) return owner
    if (tryClearStaleLock(lockPath, staleLockMs)) continue
    if (attempt + 1 < retries) sleepSync(retryDelayMs)
  }

  throw new MemoryLockError('Memory operations are locked. Try again shortly.')
}

async function acquireLockAsync(
  lockPath: string,
  options: MemoryLockOptions,
): Promise<LockOwner> {
  const { retries, retryDelayMs, staleLockMs } = resolveOptions(options)

  for (let attempt = 0; attempt < retries; attempt += 1) {
    const owner = tryAcquireLock(lockPath)
    if (owner) return owner
    if (tryClearStaleLock(lockPath, staleLockMs)) continue
    if (attempt + 1 < retries) await sleepAsync(retryDelayMs)
  }

  throw new MemoryLockError('Memory operations are locked. Try again shortly.')
}

function tryAcquireLock(lockPath: string): LockOwner | null {
  const owner: LockOwner = {
    pid: process.pid,
    timestamp: new Date().toISOString(),
    token: randomUUID(),
  }

  let descriptor: number
  try {
    descriptor = openSync(lockPath, 'wx')
  } catch (error) {
    if (hasErrorCode(error, 'EEXIST')) return null
    throw error
  }

  try {
    writeFileSync(descriptor, JSON.stringify(owner), 'utf-8')
    return owner
  } catch (error) {
    try {
      unlinkSync(lockPath)
    } catch {}
    throw error
  } finally {
    closeSync(descriptor)
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  )
}

function releaseLock(lockPath: string, owner: LockOwner): void {
  try {
    const currentOwner = JSON.parse(
      readFileSync(lockPath, 'utf-8'),
    ) as LockOwner
    if (currentOwner.token === owner.token) unlinkSync(lockPath)
  } catch {
    // The lock was already removed or replaced; never remove an unknown owner.
  }
}

function tryClearStaleLock(lockPath: string, staleLockMs: number): boolean {
  if (!existsSync(lockPath)) return false
  try {
    const stats = statSync(lockPath)
    if (Date.now() - stats.mtimeMs <= staleLockMs) return false
    unlinkSync(lockPath)
    return true
  } catch {
    return false
  }
}

function resolveOptions(
  options: MemoryLockOptions,
): Required<MemoryLockOptions> {
  return {
    retries: options.retries ?? DEFAULT_RETRIES,
    retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    staleLockMs: options.staleLockMs ?? DEFAULT_STALE_LOCK_MS,
  }
}

function sleepSync(ms: number): void {
  if (ms <= 0) return
  const buffer = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(buffer), 0, 0, ms)
}

function sleepAsync(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}
