import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { searchRecall } from '../src/recall/search'

function withTempCwd(run: () => void): void {
  const root = mkdtempSync(join(tmpdir(), 'continuum-recall-search-'))
  const previous = process.cwd()
  try {
    process.chdir(root)
    run()
  } finally {
    process.chdir(previous)
    rmSync(root, { recursive: true, force: true })
  }
}

function buildSummary(sessionId: string, title: string, focus: string): string {
  return [
    '---',
    `session_id: ${sessionId}`,
    `title: ${title}`,
    '---',
    '',
    `# Session Summary: ${title}`,
    '',
    '## Focus',
    '',
    focus,
    '',
  ].join('\n')
}

describe('searchRecall', () => {
  test('bm25 mode returns matches', () => {
    withTempCwd(() => {
      const recallDir = join(process.cwd(), '.continuum', 'recall', 'opencode')
      mkdirSync(recallDir, { recursive: true })

      writeFileSync(
        join(recallDir, 'OPENCODE-SUMMARY-2026-02-10T10-00-00-alpha.md'),
        buildSummary('ses-alpha', 'Alpha Session', 'Alpha recall focus.'),
        'utf-8',
      )
      writeFileSync(
        join(recallDir, 'OPENCODE-SUMMARY-2026-02-10T10-00-00-beta.md'),
        buildSummary('ses-beta', 'Beta Session', 'Beta recall focus.'),
        'utf-8',
      )

      const result = searchRecall({ query: 'alpha', mode: 'bm25' })
      expect(result.mode).toBe('bm25')
      expect(result.fallback).toBe(false)
      expect(result.filesSearched).toBe(2)
      expect(result.results).toHaveLength(1)
      expect(result.results[0].sessionId).toBe('ses-alpha')
    })
  })

  test('auto mode falls back when bm25 has no hits', () => {
    withTempCwd(() => {
      const recallDir = join(process.cwd(), '.continuum', 'recall', 'opencode')
      mkdirSync(recallDir, { recursive: true })

      writeFileSync(
        join(recallDir, 'OPENCODE-SUMMARY-2026-02-10T10-00-00-alpha.md'),
        buildSummary('ses-alpha', 'Alpha Session', 'Alpha recall focus.'),
        'utf-8',
      )

      const result = searchRecall({ query: 'gamma', mode: 'auto' })
      expect(result.mode).toBe('semantic')
      expect(result.fallback).toBe(true)
      expect(result.filesSearched).toBe(1)
      expect(result.results).toHaveLength(0)
    })
  })
})
