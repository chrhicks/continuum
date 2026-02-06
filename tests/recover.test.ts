import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { recoverStaleNowFiles, scanStaleNowFiles } from '../src/memory/recover'

function withTempMemory(run: (memoryDir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'continuum-recover-'))
  const memoryDir = join(root, '.continuum', 'memory')
  mkdirSync(memoryDir, { recursive: true })
  try {
    run(memoryDir)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function withTempCwd(run: () => void): void {
  const root = mkdtempSync(join(tmpdir(), 'continuum-recover-cwd-'))
  const previous = process.cwd()
  try {
    process.chdir(root)
    run()
  } finally {
    process.chdir(previous)
    rmSync(root, { recursive: true, force: true })
  }
}

describe('memory recover scan', () => {
  test('identifies stale NOW files based on timestamp_start', () => {
    withTempMemory((memoryDir) => {
      const nowMs = Date.parse('2026-02-02T12:00:00Z')
      const staleStart = new Date(nowMs - 10 * 60 * 60 * 1000).toISOString()
      const freshStart = new Date(nowMs - 2 * 60 * 60 * 1000).toISOString()

      writeFileSync(
        join(memoryDir, 'NOW-stale.md'),
        `---\ntimestamp_start: ${staleStart}\n---\n# Stale\n`,
        'utf-8',
      )
      writeFileSync(
        join(memoryDir, 'NOW-fresh.md'),
        `---\ntimestamp_start: ${freshStart}\n---\n# Fresh\n`,
        'utf-8',
      )

      const result = scanStaleNowFiles({ memoryDir, maxHours: 6, nowMs })
      expect(result.totalNowFiles).toBe(2)
      expect(result.staleNowFiles).toHaveLength(1)
      expect(result.staleNowFiles[0].filePath.endsWith('NOW-stale.md')).toBe(
        true,
      )
    })
  })
})

describe('memory recover consolidate', () => {
  test('does not delete other stale NOW files during recovery', () => {
    withTempCwd(() => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })

      const staleStart = '2026-02-01T00:00:00.000Z'
      const staleEnd = '2026-02-01T00:10:00.000Z'
      const nowOne = join(memoryDir, 'NOW-stale-one.md')
      const nowTwo = join(memoryDir, 'NOW-stale-two.md')

      const buildNow = (sessionId: string) =>
        [
          '---',
          `session_id: ${sessionId}`,
          `timestamp_start: ${staleStart}`,
          `timestamp_end: ${staleEnd}`,
          'duration_minutes: null',
          `project_path: ${process.cwd()}`,
          'tags: []',
          'parent_session: null',
          'related_tasks: []',
          'memory_type: NOW',
          '---',
          '',
          `# Session: ${sessionId} - 2026-02-01 00:00 UTC`,
          '',
          '@decision: recover',
          '',
        ].join('\n')

      writeFileSync(nowOne, buildNow('sess_one'), 'utf-8')
      writeFileSync(nowTwo, buildNow('sess_two'), 'utf-8')

      recoverStaleNowFiles({ maxHours: 1, consolidate: true })

      expect(existsSync(nowOne)).toBe(true)
      expect(existsSync(nowTwo)).toBe(true)
    })
  })
})
