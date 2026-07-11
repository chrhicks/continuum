import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { initMemory } from '../src/memory/init'
import {
  getMemoryLockPath,
  withMemoryLock,
  withMemoryLockAsync,
} from '../src/memory/lock'

async function withTempCwd(run: () => Promise<void> | void): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'continuum-memory-lock-'))
  const previous = process.cwd()
  try {
    process.chdir(root)
    await run()
  } finally {
    process.chdir(previous)
    rmSync(root, { recursive: true, force: true })
  }
}

describe('memory lock', () => {
  test('clears stale lock files', async () => {
    await withTempCwd(() => {
      initMemory()
      const memoryLockPath = getMemoryLockPath()
      writeFileSync(memoryLockPath, 'lock', 'utf-8')
      const staleTime = new Date(Date.now() - 120_000)
      utimesSync(memoryLockPath, staleTime, staleTime)

      const result = withMemoryLock(() => 'ok')

      expect(result).toBe('ok')
      expect(existsSync(memoryLockPath)).toBe(false)
    })
  })

  test('throws when lock is held', async () => {
    await withTempCwd(() => {
      initMemory()
      const memoryLockPath = getMemoryLockPath()
      writeFileSync(memoryLockPath, 'lock', 'utf-8')

      expect(() =>
        withMemoryLock(() => 'ok', {
          retries: 1,
          retryDelayMs: 1,
          staleLockMs: 999_999,
        }),
      ).toThrow('Memory operations are locked. Try again shortly.')
      expect(existsSync(memoryLockPath)).toBe(true)
    })
  })

  test('preserves action errors without retrying the action', async () => {
    await withTempCwd(async () => {
      initMemory()
      const expected = new Error('underlying operation failed')
      let attempts = 0

      await expect(
        withMemoryLockAsync(async () => {
          attempts += 1
          throw expected
        }),
      ).rejects.toBe(expected)

      expect(attempts).toBe(1)
      expect(existsSync(getMemoryLockPath())).toBe(false)
    })
  })

  test('does not remove a replacement lock owned by another operation', async () => {
    await withTempCwd(() => {
      initMemory()
      const memoryLockPath = getMemoryLockPath()
      const replacement = JSON.stringify({
        pid: 999_999,
        timestamp: new Date().toISOString(),
        token: 'replacement-owner',
      })

      withMemoryLock(() => {
        unlinkSync(memoryLockPath)
        writeFileSync(memoryLockPath, replacement, 'utf-8')
      })

      expect(readFileSync(memoryLockPath, 'utf-8')).toBe(replacement)
    })
  })
})
