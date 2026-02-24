import { describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { getStatus } from '../src/memory/status'
import { memoryPath } from '../src/memory/paths'

function withTempCwd(run: () => void): void {
  const root = mkdtempSync(join(tmpdir(), 'continuum-cli-'))
  const previous = process.cwd()
  try {
    process.chdir(root)
    run()
  } finally {
    process.chdir(previous)
    rmSync(root, { recursive: true, force: true })
  }
}

describe('memory status sizes', () => {
  test('reports total memory and NOW sizes', () => {
    withTempCwd(() => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })

      const nowFileName = 'NOW-2026-02-02T16-00-00.md'
      const nowPath = join(memoryDir, nowFileName)
      const recentPath = join(memoryDir, 'RECENT.md')
      const currentPath = join(memoryDir, '.current')

      writeFileSync(nowPath, 'hello', 'utf-8')
      writeFileSync(recentPath, 'abc', 'utf-8')
      writeFileSync(currentPath, nowFileName, 'utf-8')

      const expectedTotal = [nowPath, recentPath, currentPath]
        .map((path) => statSync(path).size)
        .reduce((sum, size) => sum + size, 0)

      const status = getStatus()

      expect(status.nowBytes).toBe(statSync(nowPath).size)
      expect(status.memoryBytes).toBe(expectedTotal)
    })
  })

  test('falls back to latest NOW file when pointer missing', () => {
    withTempCwd(() => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })

      const olderPath = join(memoryDir, 'NOW-2026-02-01T16-00-00.md')
      const newerPath = join(memoryDir, 'NOW-2026-02-02T16-00-00.md')

      writeFileSync(olderPath, 'old', 'utf-8')
      writeFileSync(newerPath, 'alpha\nbeta', 'utf-8')

      const olderTime = new Date(Date.now() - 2 * 60 * 60 * 1000)
      const newerTime = new Date(Date.now() - 5 * 60 * 1000)
      utimesSync(olderPath, olderTime, olderTime)
      utimesSync(newerPath, newerTime, newerTime)

      const status = getStatus()

      expect(status.nowPath).toBe(memoryPath('NOW-2026-02-02T16-00-00.md'))
      expect(status.nowLines).toBe(2)
    })
  })
})
