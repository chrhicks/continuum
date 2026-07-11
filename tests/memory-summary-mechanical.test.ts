import { describe, expect, test } from 'bun:test'
import { mechanicalSummary } from '../src/memory/summarize'

describe('mechanical memory summary', () => {
  test('retains agent content for search without an LLM', () => {
    const body = [
      '## Agent: Decision: workspace-isolation-marker-7429',
      '',
      'Literal `code`, $HOME, and $(not-run).',
    ].join('\n')

    const summary = mechanicalSummary(body)

    expect(summary.narrative).toBe(body)
    expect(summary.narrative).toContain('workspace-isolation-marker-7429')
    expect(summary.narrative).toContain('$(not-run)')
  })
})
