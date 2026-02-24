import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  evaluateRecallSearch,
  type RecallSearchEvalCase,
} from '../src/recall/search/eval'

function withTempDir(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'continuum-recall-eval-'))
  try {
    run(root)
  } finally {
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

describe('evaluateRecallSearch', () => {
  test('evaluates bm25 and auto modes', () => {
    withTempDir((root) => {
      const summaryDir = join(root, '.continuum', 'recall', 'opencode')
      mkdirSync(summaryDir, { recursive: true })

      writeFileSync(
        join(summaryDir, 'OPENCODE-SUMMARY-2026-02-10T10-00-00-ses_alpha.md'),
        buildSummary('ses_alpha', 'Alpha Session', 'Alpha recall focus.'),
        'utf-8',
      )
      writeFileSync(
        join(summaryDir, 'OPENCODE-SUMMARY-2026-02-10T10-00-00-ses_beta.md'),
        buildSummary(
          'ses_beta',
          'Beta Session',
          'Beta recall focus with extra signal.',
        ),
        'utf-8',
      )

      const cases: RecallSearchEvalCase[] = [
        {
          id: 'exact-alpha',
          category: 'exact',
          query: 'alpha recall',
          expectedSessionId: 'ses_alpha',
        },
        {
          id: 'semantic-beta',
          category: 'semantic',
          query: 'focus signal beta',
          expectedSessionId: 'ses_beta',
        },
        {
          id: 'negative-none',
          category: 'negative',
          query: 'kubernetes ingress',
        },
      ]

      const result = evaluateRecallSearch({
        cases,
        summaryDir,
        modes: ['bm25', 'auto'],
        limit: 5,
      })

      expect(result.summary.bm25.total).toBe(3)
      expect(result.summary.bm25.pass).toBe(3)
      expect(result.summary.auto.pass).toBe(3)
      expect(result.summary.auto.categories.negative.pass).toBe(1)

      const negative = result.results.find(
        (entry) => entry.test.id === 'negative-none',
      )
      const autoResult = negative?.modeResults.find(
        (modeResult) => modeResult.requestedMode === 'auto',
      )
      expect(autoResult?.fallback).toBe(true)
      expect(autoResult?.mode).toBe('semantic')
    })
  })
})
