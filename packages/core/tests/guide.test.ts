import { describe, expect, test } from 'bun:test'
import { getGuide } from '@continuum/core'

describe('Continuum guide', () => {
  test('describes the complete composable memory workflow', () => {
    const guide = getGuide()

    expect(guide.version).toBe(1)
    expect(guide.operations.map((operation) => operation.name)).toEqual([
      'continuum_summary',
      'continuum_memory_record',
      'continuum_memory_search',
      'continuum_memory_get',
    ])
    expect(guide.workflow.join('\n')).toContain('before and during work')
    expect(guide.workflow.join('\n')).toContain('supersedes')
    expect(guide.recordKinds.conventional).toContain('decision')
    expect(guide.recordKinds.guidance).toContain('not an enum')
  })
})
