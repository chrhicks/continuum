import { describe, expect, test } from 'bun:test'
import {
  mergeRecallSummaryItems,
  type RecallSummaryItem,
} from '../src/memory/opencode/summary-merge'
import type { RecallSummaryResult } from '../src/memory/opencode/summary-schema'

function summary(focus: string): RecallSummaryResult {
  return {
    focus,
    decisions: [],
    discoveries: [],
    patterns: [],
    tasks: [],
    files: [],
    blockers: [],
    open_questions: [],
    next_steps: [],
    confidence: 'low',
  }
}

async function firstSummary(
  summaries: RecallSummaryResult[],
): Promise<RecallSummaryResult> {
  const first = summaries[0]
  if (!first) throw new Error('Expected a summary group')
  return first
}

describe('recall summary merge reducer', () => {
  test('uses budgeted grouping before pairing', async () => {
    const items: RecallSummaryItem[] = [
      { summary: summary('one'), estTokens: 3 },
      { summary: summary('two'), estTokens: 2 },
      { summary: summary('three'), estTokens: 2 },
    ]
    const result = await mergeRecallSummaryItems(
      items,
      { maxTokens: 6 },
      firstSummary,
    )
    expect(result.report.passes[0]?.mode).toBe('budgeted')
    expect(result.report.passes[0]?.group_sizes).toEqual([2, 1])
  })

  test('pairs summaries when each exceeds the budget', async () => {
    const items = ['one', 'two', 'three', 'four'].map((focus) => ({
      summary: summary(focus),
      estTokens: 10,
    }))
    const result = await mergeRecallSummaryItems(
      items,
      { maxTokens: 5 },
      firstSummary,
    )
    expect(result.report.passes[0]?.mode).toBe('pair-fallback')
    expect(result.report.passes[0]?.group_sizes).toEqual([2, 2])
  })
})
