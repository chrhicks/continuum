import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  acquireProjectionPublicationLock,
  releaseProjectionPublicationLock,
  type ProjectionLockRuntime,
} from '../src/memory/projection/publication-lock'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('projection publication lock ownership', () => {
  test('does not evict an aged lock while its owner is alive', () => {
    const memoryDir = makeMemoryDir()
    const clock = { now: 1_000 }
    const owner = acquireProjectionPublicationLock(
      memoryDir,
      runtime(101, 'owner', clock),
    )
    age(owner.lockPath)

    expect(() =>
      acquireProjectionPublicationLock(
        memoryDir,
        runtime(202, 'contender', clock, (pid) => pid === 101),
      ),
    ).toThrow('Timed out waiting for projection lock')
    expect(existsSync(owner.ownerPath)).toBe(true)

    releaseProjectionPublicationLock(owner)
  })

  test('recovers an abandoned lock without allowing a stale release or third owner', () => {
    const memoryDir = makeMemoryDir()
    const clock = { now: 1_000 }
    const abandoned = acquireProjectionPublicationLock(
      memoryDir,
      runtime(101, 'abandoned', clock),
    )
    age(abandoned.lockPath)

    const replacement = acquireProjectionPublicationLock(
      memoryDir,
      runtime(202, 'replacement', clock),
    )
    expect(existsSync(replacement.ownerPath)).toBe(true)

    releaseProjectionPublicationLock(abandoned)
    expect(existsSync(replacement.ownerPath)).toBe(true)
    age(replacement.lockPath)

    expect(() =>
      acquireProjectionPublicationLock(
        memoryDir,
        runtime(303, 'third', clock, (pid) => pid === 202),
      ),
    ).toThrow('Timed out waiting for projection lock')
    expect(existsSync(replacement.ownerPath)).toBe(true)

    releaseProjectionPublicationLock(replacement)
  })
})

function makeMemoryDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'continuum-projection-lock-'))
  roots.push(root)
  return join(root, 'memory')
}

function age(lockPath: string): void {
  const epoch = new Date(0)
  utimesSync(lockPath, epoch, epoch)
}

function runtime(
  pid: number,
  token: string,
  clock: { now: number },
  isProcessAlive: (pid: number) => boolean = () => false,
): ProjectionLockRuntime {
  return {
    pid,
    timeoutMs: 30,
    staleLockMs: 100,
    now: () => clock.now,
    createToken: () => token,
    isProcessAlive,
    wait: (milliseconds) => {
      clock.now += milliseconds
    },
  }
}
