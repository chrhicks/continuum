import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'

import { appendUserMessage } from '../src/memory/now-writer'
import { startSession } from '../src/memory/session'

async function withTempCwd(run: () => Promise<void> | void): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'continuum-now-writer-'))
  const previous = process.cwd()
  try {
    process.chdir(root)
    await run()
  } finally {
    process.chdir(previous)
    rmSync(root, { recursive: true, force: true })
  }
}

describe('now writer', () => {
  test('clears stale lock files', async () => {
    await withTempCwd(async () => {
      const info = startSession()
      const lockPath = join(process.cwd(), '.continuum', 'memory', '.now.lock')
      writeFileSync(lockPath, 'lock', 'utf-8')
      const staleTime = new Date(Date.now() - 120_000)
      utimesSync(lockPath, staleTime, staleTime)

      await appendUserMessage('stale lock test')

      expect(existsSync(lockPath)).toBe(false)
      const content = readFileSync(info.filePath, 'utf-8')
      expect(content).toContain('## User: stale lock test')
    })
  })

  test('auto-starts a session when missing', async () => {
    await withTempCwd(async () => {
      await appendUserMessage('auto start')

      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      const nowFiles = readdirSync(memoryDir).filter(
        (name) => name.startsWith('NOW-') && name.endsWith('.md'),
      )
      expect(nowFiles).toHaveLength(1)

      const current = readFileSync(join(memoryDir, '.current'), 'utf-8').trim()
      expect(current).toBe(nowFiles[0])

      const content = readFileSync(join(memoryDir, nowFiles[0]), 'utf-8')
      expect(content).toContain('## User: auto start')
    })
  })

  test('appends messages in order', async () => {
    await withTempCwd(async () => {
      await appendUserMessage('first entry')
      await appendUserMessage('second entry')

      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      const current = readFileSync(join(memoryDir, '.current'), 'utf-8').trim()
      const content = readFileSync(join(memoryDir, current), 'utf-8')
      const firstIndex = content.indexOf('## User: first entry')
      const secondIndex = content.indexOf('## User: second entry')

      expect(firstIndex).toBeGreaterThan(-1)
      expect(secondIndex).toBeGreaterThan(firstIndex)
    })
  })

  test('resumes the latest NOW file when pointer is missing', async () => {
    await withTempCwd(async () => {
      const first = startSession()
      const second = startSession()

      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      unlinkSync(join(memoryDir, '.current'))

      const olderTime = new Date(Date.now() - 2 * 60 * 60 * 1000)
      const newerTime = new Date(Date.now() - 5 * 60 * 1000)
      utimesSync(first.filePath, olderTime, olderTime)
      utimesSync(second.filePath, newerTime, newerTime)

      await appendUserMessage('resume test')

      const current = readFileSync(join(memoryDir, '.current'), 'utf-8').trim()
      expect(current).toBe(basename(second.filePath))

      const content = readFileSync(second.filePath, 'utf-8')
      expect(content).toContain('## User: resume test')
    })
  })
})
