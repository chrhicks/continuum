import { describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { searchMemory } from '../src/memory/search'

function withTempCwd(run: () => void): void {
  const root = mkdtempSync(join(tmpdir(), 'continuum-search-'))
  const previous = process.cwd()
  try {
    process.chdir(root)
    run()
  } finally {
    process.chdir(previous)
    rmSync(root, { recursive: true, force: true })
  }
}

describe('searchMemory', () => {
  test('filters by tags', () => {
    withTempCwd(() => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })

      const taggedAlpha = join(memoryDir, 'NOW-2026-02-02T00-00-00-alpha.md')
      const taggedBeta = join(memoryDir, 'NOW-2026-02-02T00-00-00-beta.md')
      const alphaRelative = join(
        '.continuum',
        'memory',
        'NOW-2026-02-02T00-00-00-alpha.md',
      )

      writeFileSync(
        taggedAlpha,
        '---\ntags: [alpha, beta]\n---\nhello alpha\n',
        'utf-8',
      )
      writeFileSync(taggedBeta, '---\ntags: [beta]\n---\nhello beta\n', 'utf-8')

      const alphaOnly = searchMemory('hello', 'all', ['alpha'])
      expect(alphaOnly.matches).toHaveLength(1)
      expect(alphaOnly.matches[0].filePath).toBe(alphaRelative)
      expect(alphaOnly.filesSearched).toBe(2)

      const betaOnly = searchMemory('hello', 'all', ['beta'])
      expect(betaOnly.matches).toHaveLength(2)
      expect(betaOnly.filesSearched).toBe(2)

      const bothTags = searchMemory('hello', 'all', ['alpha', 'beta'])
      expect(bothTags.matches).toHaveLength(1)
      expect(bothTags.matches[0].filePath).toBe(alphaRelative)
      expect(bothTags.filesSearched).toBe(2)

      const noTags = searchMemory('hello', 'all', [])
      expect(noTags.matches).toHaveLength(2)
      expect(noTags.filesSearched).toBe(2)

      const missingTags = searchMemory('hello', 'all', ['gamma'])
      expect(missingTags.matches).toHaveLength(0)
      expect(missingTags.filesSearched).toBe(2)
    })
  })

  test('counts only readable files', () => {
    withTempCwd(() => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })

      const nowPath = join(memoryDir, 'NOW-2026-02-02T00-00-00.md')
      writeFileSync(nowPath, 'hello', 'utf-8')
      symlinkSync(
        join(memoryDir, 'missing.md'),
        join(memoryDir, 'NOW-missing.md'),
      )

      const result = searchMemory('hello', 'all')
      expect(result.filesSearched).toBe(1)
    })
  })

  test('filters by --after timestamp window', () => {
    withTempCwd(() => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })

      writeFileSync(
        join(memoryDir, 'NOW-2026-02-02T00-00-00-early.md'),
        [
          '---',
          'timestamp_start: 2026-02-02T00:00:00.000Z',
          '---',
          'hello early',
          '',
        ].join('\n'),
        'utf-8',
      )
      writeFileSync(
        join(memoryDir, 'NOW-2026-02-03T00-00-00-late.md'),
        [
          '---',
          'timestamp_start: 2026-02-03T00:00:00.000Z',
          '---',
          'hello late',
          '',
        ].join('\n'),
        'utf-8',
      )

      const result = searchMemory(
        'hello',
        'all',
        [],
        new Date('2026-02-02T12:00:00.000Z'),
      )

      expect(result.filesSearched).toBe(2)
      expect(result.matches).toHaveLength(1)
      expect(result.matches[0].filePath).toContain('late.md')
    })
  })
})
