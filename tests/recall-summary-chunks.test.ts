import { describe, expect, test } from 'bun:test'

import { planRecallSummaryChunks } from '../src/recall/opencode/summary-chunks'

describe('recall summary chunk planner', () => {
  test('splits blocks by max chars', () => {
    const blocks = ['alpha', 'bravo', 'charlie']
    const chunks = planRecallSummaryChunks(blocks, {
      maxChars: 10,
      maxLines: 10,
    })

    expect(chunks.length).toBe(3)
    expect(chunks[0].content).toBe('alpha')
    expect(chunks[1].content).toBe('bravo')
    expect(chunks[2].content).toBe('charlie')
    expect(chunks[0].index).toBe(1)
    expect(chunks[0].total).toBe(3)
  })

  test('splits blocks by max lines', () => {
    const blocks = ['one\ntwo', 'three\nfour', 'five']
    const chunks = planRecallSummaryChunks(blocks, {
      maxChars: 200,
      maxLines: 3,
    })

    expect(chunks.length).toBe(3)
    expect(chunks[0].lineCount).toBe(2)
    expect(chunks[1].lineCount).toBe(2)
    expect(chunks[2].lineCount).toBe(1)
  })

  test('keeps oversized blocks as single chunks', () => {
    const blocks = ['a\nb\nc\nd', 'e']
    const chunks = planRecallSummaryChunks(blocks, {
      maxChars: 200,
      maxLines: 2,
    })

    expect(chunks.length).toBe(2)
    expect(chunks[0].lineCount).toBe(4)
    expect(chunks[0].content).toBe('a\nb\nc\nd')
  })
})
