import { describe, expect, test } from 'bun:test'
import { planRecallSummaryChunks } from '../src/memory/opencode/summary-chunks'

describe('recall summary chunk planner', () => {
  test('splits blocks by character and line limits', () => {
    const byCharacters = planRecallSummaryChunks(
      ['alpha', 'bravo', 'charlie'],
      {
        maxChars: 10,
        maxLines: 10,
      },
    )
    expect(byCharacters.map((chunk) => chunk.content)).toEqual([
      'alpha',
      'bravo',
      'charlie',
    ])
    expect(byCharacters.map((chunk) => chunk.total)).toEqual([3, 3, 3])

    const byLines = planRecallSummaryChunks(
      ['one\ntwo', 'three\nfour', 'five'],
      { maxChars: 200, maxLines: 3 },
    )
    expect(byLines.map((chunk) => chunk.lineCount)).toEqual([2, 2, 1])
  })

  test('retains an oversized block as one chunk', () => {
    const chunks = planRecallSummaryChunks(['a\nb\nc\nd', 'e'], {
      maxChars: 200,
      maxLines: 2,
    })
    expect(chunks[0]?.content).toBe('a\nb\nc\nd')
    expect(chunks[0]?.blockCount).toBe(1)
  })
})
