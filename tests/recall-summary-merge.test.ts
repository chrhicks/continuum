import { describe, expect, test } from 'bun:test'

import {
  mergeRecallSummaryItems,
  type RecallSummaryItem,
} from '../src/recall/opencode/summary-merge'
import { type RecallSummaryResult } from '../src/recall/opencode/summary-schema'

const buildSummary = (focus: string): RecallSummaryResult => ({
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
})

describe('recall summary merge reducer', () => {
  test('uses budgeted grouping before pairing', async () => {
    const items: RecallSummaryItem[] = [
      { summary: buildSummary('one'), estTokens: 3 },
      { summary: buildSummary('two'), estTokens: 2 },
      { summary: buildSummary('three'), estTokens: 2 },
    ]
    const result = await mergeRecallSummaryItems(
      items,
      { maxTokens: 6 },
      async (summaries) => summaries[0],
    )

    expect(result.report.passes[0]?.mode).toBe('budgeted')
    expect(result.report.passes[0]?.group_sizes).toEqual([2, 1])
    expect(result.report.passes[0]?.group_est_tokens).toEqual([5, 2])
  })

  test('falls back to pair grouping when every item exceeds budget', async () => {
    const items: RecallSummaryItem[] = [
      { summary: buildSummary('one'), estTokens: 10 },
      { summary: buildSummary('two'), estTokens: 10 },
      { summary: buildSummary('three'), estTokens: 10 },
      { summary: buildSummary('four'), estTokens: 10 },
    ]
    const result = await mergeRecallSummaryItems(
      items,
      { maxTokens: 5 },
      async (summaries) => summaries[0],
    )

    expect(result.report.passes[0]?.mode).toBe('pair-fallback')
    expect(result.report.passes[0]?.group_sizes).toEqual([2, 2])
    expect(result.report.passes[0]?.group_est_tokens).toEqual([20, 20])
  })
})
