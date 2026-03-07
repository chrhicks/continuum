import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { searchRetrieval } from '../src/memory/retrieval/search'

function withTempCwd(run: () => void): void {
  const root = mkdtempSync(join(tmpdir(), 'continuum-retrieval-search-'))
  const previous = process.cwd()
  try {
    process.chdir(root)
    run()
  } finally {
    process.chdir(previous)
    rmSync(root, { recursive: true, force: true })
  }
}

describe('searchRetrieval', () => {
  test('searches memory and recall by default', () => {
    withTempCwd(() => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      const recallDir = join(process.cwd(), '.continuum', 'recall', 'opencode')
      mkdirSync(memoryDir, { recursive: true })
      mkdirSync(recallDir, { recursive: true })

      writeFileSync(
        join(memoryDir, 'NOW-2026-02-02T00-00-00-alpha.md'),
        '---\ntags: [alpha]\n---\nhello world\n',
        'utf-8',
      )
      writeFileSync(
        join(recallDir, 'OPENCODE-SUMMARY-2026-02-10T10-00-00-alpha.md'),
        [
          '---',
          'session_id: ses_alpha',
          'title: Alpha Session',
          'created_at: 2026-02-10T10:00:00.000Z',
          '---',
          '',
          '# Session Summary: Alpha Session',
          '',
          '## Focus',
          '',
          'hello recall focus',
          '',
        ].join('\n'),
        'utf-8',
      )

      const result = searchRetrieval({ query: 'hello' })

      expect(result.filesSearched).toBe(2)
      expect(result.memoryFilesSearched).toBe(1)
      expect(result.recallFilesSearched).toBe(1)
      expect(result.matches.map((match) => match.source)).toEqual([
        'memory',
        'recall',
      ])
    })
  })

  test('supports explicit source filtering', () => {
    withTempCwd(() => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      const recallDir = join(process.cwd(), '.continuum', 'recall', 'opencode')
      mkdirSync(memoryDir, { recursive: true })
      mkdirSync(recallDir, { recursive: true })

      writeFileSync(
        join(memoryDir, 'NOW-2026-02-02T00-00-00.md'),
        'alpha',
        'utf-8',
      )
      writeFileSync(
        join(recallDir, 'OPENCODE-SUMMARY-2026-02-10T10-00-00-alpha.md'),
        [
          '---',
          'session_id: ses_alpha',
          '---',
          '',
          '# Session Summary: Alpha',
          '',
          '## Focus',
          '',
          'alpha',
          '',
        ].join('\n'),
        'utf-8',
      )

      const memoryOnly = searchRetrieval({ query: 'alpha', source: 'memory' })
      const recallOnly = searchRetrieval({ query: 'alpha', source: 'recall' })

      expect(memoryOnly.matches).toHaveLength(1)
      expect(memoryOnly.matches[0]?.source).toBe('memory')
      expect(recallOnly.matches).toHaveLength(1)
      expect(recallOnly.matches[0]?.source).toBe('recall')
    })
  })

  test('filters recall results by afterDate', () => {
    withTempCwd(() => {
      const recallDir = join(process.cwd(), '.continuum', 'recall', 'opencode')
      mkdirSync(recallDir, { recursive: true })

      writeFileSync(
        join(recallDir, 'OPENCODE-SUMMARY-2026-02-01T10-00-00-old.md'),
        [
          '---',
          'session_id: ses_old',
          'created_at: 2026-02-01T10:00:00.000Z',
          '---',
          '',
          '# Session Summary: Old',
          '',
          '## Focus',
          '',
          'alpha old',
          '',
        ].join('\n'),
        'utf-8',
      )
      writeFileSync(
        join(recallDir, 'OPENCODE-SUMMARY-2026-02-03T10-00-00-new.md'),
        [
          '---',
          'session_id: ses_new',
          'created_at: 2026-02-03T10:00:00.000Z',
          '---',
          '',
          '# Session Summary: New',
          '',
          '## Focus',
          '',
          'alpha new',
          '',
        ].join('\n'),
        'utf-8',
      )

      const result = searchRetrieval({
        query: 'alpha',
        source: 'recall',
        afterDate: new Date('2026-02-02T00:00:00.000Z'),
      })

      expect(result.recallFilesSearched).toBe(1)
      expect(result.matches).toHaveLength(1)
      expect(result.matches[0]?.sessionId).toBe('ses_new')
    })
  })
})
