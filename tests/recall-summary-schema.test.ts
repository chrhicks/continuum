import { describe, expect, test } from 'bun:test'

import { validateRecallSummaryInput } from '../src/memory/opencode/summary-schema'

function buildSummary(overrides: Record<string, unknown> = {}) {
  return {
    focus: 'session focus',
    decisions: [],
    discoveries: [],
    patterns: [],
    tasks: [],
    files: [],
    blockers: [],
    open_questions: [],
    next_steps: [],
    confidence: 'low',
    keywords: null,
    ...overrides,
  }
}

describe('recall summary schema', () => {
  test('accepts null keywords from strict structured output', () => {
    const result = validateRecallSummaryInput(buildSummary())
    expect(result.keywords).toBeUndefined()
  })

  test('accepts populated keyword blocks', () => {
    const result = validateRecallSummaryInput(
      buildSummary({
        keywords: {
          commands: ['continuum memory collect'],
          flags: ['--summarize'],
          errors: [],
          constants: [],
          numbers: [],
          files: ['src/memory/opencode/summary-schema.ts'],
          ids: [],
          aliases: [],
        },
      }),
    )

    expect(result.keywords?.commands).toEqual(['continuum memory collect'])
  })
})
