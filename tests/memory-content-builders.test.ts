import { describe, expect, test } from 'bun:test'
import {
  buildClearedNowContent,
} from '../src/memory/memory-content-builders'
import {
  extractRecentEntries,
  isClearedNowBody,
  isMeaningfulEntry,
  isPlaceholderNarrative,
  scoreEntryMeaningfulness,
  upsertRecent,
} from '../src/memory/recent-content-builders'

describe('extractRecentEntries', () => {
  test('recognizes Session headings', () => {
    const lines = [
      '# RECENT - Last 3 Sessions',
      '',
      '## Session 2026-05-15 14:57 (82h 53m)',
      '',
      'No summary available.',
      '**Link**: [Full details](MEMORY-2026-05-15.md#anchor)',
      '',
      '---',
      '',
      '## Session 2026-05-19 01:51 (182h 43m)',
      '',
      'Sparse content.',
      '**Link**: [Full details](MEMORY-2026-05-19.md#anchor2)',
    ]
    const entries = extractRecentEntries(lines)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toContain('## Session 2026-05-15 14:57')
    expect(entries[1]).toContain('## Session 2026-05-19 01:51')
  })

  test('recognizes Recall Import headings (seestar regression)', () => {
    const lines = [
      '# RECENT - Last 3 Sessions',
      '',
      '## Session 2026-05-19 01:51 (182h 43m)',
      '',
      'Sparse session.',
      '',
      '---',
      '',
      '## Recall Import 2026-05-20 02:16 (2m)',
      '',
      'Rich research summary.',
      '',
      '**Decisions**:',
      '- Use GraXpert AI.',
      '',
      '**Link**: [Full details](MEMORY-2026-05-20.md#anchor)',
    ]
    const entries = extractRecentEntries(lines)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toContain('## Session 2026-05-19 01:51')
    expect(entries[1]).toContain('## Recall Import 2026-05-20 02:16')
  })

  test('recognizes Task and OpenCode Session headings', () => {
    const lines = [
      '# RECENT',
      '',
      '## Task 2026-05-01 10:00 (30m)',
      '',
      'Task work.',
      '',
      '---',
      '',
      '## OpenCode Session 2026-05-02 11:00 (1h)',
      '',
      'Coding session.',
    ]
    const entries = extractRecentEntries(lines)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toContain('## Task 2026-05-01')
    expect(entries[1]).toContain('## OpenCode Session 2026-05-02')
  })
})

describe('isClearedNowBody', () => {
  test('returns true for empty body', () => {
    expect(isClearedNowBody('')).toBe(true)
    expect(isClearedNowBody('   \n   ')).toBe(true)
  })

  test('returns true for header-only body with ended session', () => {
    expect(
      isClearedNowBody('# Session: abc - 2026-05-01 10:00 UTC\n\n', {
        duration_minutes: 5,
      }),
    ).toBe(true)
  })

  test('returns true when frontmatter has consolidated flag', () => {
    expect(
      isClearedNowBody('# Session: abc - 2026-05-01 10:00 UTC\n\n', {
        consolidated: true,
      }),
    ).toBe(true)
  })

  test('returns false for header-only body with fresh session', () => {
    // Fresh session that hasn't been ended yet: duration_minutes is null
    expect(
      isClearedNowBody('# Session: abc - 2026-05-01 10:00 UTC\n\n', {
        duration_minutes: null,
      }),
    ).toBe(false)
  })

  test('returns false for body with actual content', () => {
    expect(isClearedNowBody('# Session: abc\n\n@decision: test\n')).toBe(false)
  })
})

describe('buildClearedNowContent', () => {
  test('adds consolidated flag to frontmatter', () => {
    const result = buildClearedNowContent(
      { session_id: 's1', duration_minutes: 5 },
      ['session_id', 'duration_minutes'],
      '# Session: s1 - 2026-05-01 10:00 UTC\n\nSome content.',
    )
    expect(result).toContain('consolidated: true')
    expect(result).toContain('# Session: s1 - 2026-05-01 10:00 UTC')
    expect(result).not.toContain('Some content.')
  })
})

describe('meaningfulness scoring', () => {
  test('isPlaceholderNarrative detects known placeholders', () => {
    expect(isPlaceholderNarrative('No summary available.')).toBe(true)
    expect(
      isPlaceholderNarrative(
        'The NOW file contains only the session header and no task-loop entries.',
      ),
    ).toBe(true)
    expect(isPlaceholderNarrative('Real work was done here.')).toBe(false)
  })

  test('scoreEntryMeaningfulness rewards list items and sections', () => {
    const richEntry = [
      '## Recall Import 2026-05-20 02:16 (2m)',
      '',
      '**Source**: Imported OpenCode summary',
      '',
      'Researching ML tools.',
      '',
      '**Decisions**:',
      '- Use GraXpert AI.',
      '- Keep core open-source.',
      '',
      '**Discoveries**:',
      '- Siril works well.',
      '',
      '**Link**: [Full details](MEMORY.md#anchor)',
    ].join('\n')

    const sparseEntry = [
      '## Session 2026-05-15 14:57 (82h 53m)',
      '',
      '**Source**: NOW session',
      '',
      'No summary available.',
      '**Link**: [Full details](MEMORY.md#anchor)',
    ].join('\n')

    expect(scoreEntryMeaningfulness(richEntry)).toBeGreaterThan(
      scoreEntryMeaningfulness(sparseEntry),
    )
    expect(scoreEntryMeaningfulness(richEntry)).toBeGreaterThanOrEqual(5)
    expect(scoreEntryMeaningfulness(sparseEntry)).toBeLessThanOrEqual(1)
  })

  test('isMeaningfulEntry identifies rich vs sparse entries', () => {
    const richEntry = [
      '## Recall Import 2026-05-20 02:16 (2m)',
      '',
      '**Source**: Imported OpenCode summary',
      '',
      'Researching ML tools for astrophotography background correction, denoising, and deconvolution in a custom Seestar FIT pipeline.',
      '',
      '**Decisions**:',
      '- Use GraXpert AI.',
      '',
      '**Link**: [Full details](MEMORY.md#anchor)',
    ].join('\n')

    const sparseEntry = [
      '## Session 2026-05-15 14:57 (82h 53m)',
      '',
      '**Source**: NOW session',
      '',
      'No summary available.',
      '**Link**: [Full details](MEMORY.md#anchor)',
    ].join('\n')

    expect(isMeaningfulEntry(richEntry)).toBe(true)
    expect(isMeaningfulEntry(sparseEntry)).toBe(false)
  })
})

describe('upsertRecent meaningful retention', () => {
  test('preserves rich Recall Import entries across updates (seestar regression)', () => {
    const richRecall = [
      '## Recall Import 2026-05-20 02:16 (2m)',
      '',
      '**Source**: Imported OpenCode summary',
      '',
      'Researching ML tools.',
      '',
      '**Decisions**:',
      '- Use GraXpert AI.',
      '**Link**: [Full details](MEMORY-2026-05-20.md#session-2026-05-20-02-16-abc)',
    ].join('\n')

    const sparseSession = [
      '## Session 2026-05-19 01:51 (1m)',
      '',
      '**Source**: NOW session',
      '',
      'No summary available.',
      '**Link**: [Full details](MEMORY-2026-05-19.md#session-2026-05-19-01-51-def)',
    ].join('\n')

    // Start with the rich recall entry
    const initial = upsertRecent('RECENT.md', richRecall, {
      maxSessions: 3,
      maxLines: 500,
    })
    expect(initial).toContain('Recall Import')

    // Add a sparse session: recall should still be there
    const updated = upsertRecent(
      'RECENT.md',
      sparseSession,
      { maxSessions: 3, maxLines: 500 },
      initial,
    )
    expect(updated).toContain('Recall Import')
    expect(updated).toContain('Session 2026-05-19')
  })

  test('deduplication prefers richer entry for same anchor', () => {
    const richEntry = [
      '## Session 2026-05-15 14:57 (5m)',
      '',
      '**Source**: NOW session',
      '',
      'Lots of real work done here with many discoveries.',
      '',
      '**Decisions**:',
      '- Important decision one.',
      '- Important decision two.',
      '**Link**: [Full details](MEMORY-2026-05-15.md#session-2026-05-15-14-57-abc)',
    ].join('\n')

    const sparseDuplicate = [
      '## Session 2026-05-15 14:57 (5m)',
      '',
      '**Source**: NOW session',
      '',
      'No summary available.',
      '**Link**: [Full details](MEMORY-2026-05-15.md#session-2026-05-15-14-57-abc)',
    ].join('\n')

    const existing = upsertRecent('RECENT.md', richEntry, {
      maxSessions: 3,
      maxLines: 500,
    })

    const updated = upsertRecent(
      'RECENT.md',
      sparseDuplicate,
      { maxSessions: 3, maxLines: 500 },
      existing,
    )

    // Should keep the rich entry, not overwrite with sparse
    expect(updated).toContain('Lots of real work done here')
    expect(updated).not.toContain('No summary available.')
  })

  test('keeps newest entries first across repeated upserts', () => {
    const olderEntry = [
      '## Session 2026-05-20 10:00 (1m)',
      '',
      'Older work.',
      '**Link**: [Full details](MEMORY-2026-05-20.md#older)',
    ].join('\n')

    const newerEntry = [
      '## Session 2026-05-21 10:00 (1m)',
      '',
      'Newer work.',
      '**Link**: [Full details](MEMORY-2026-05-21.md#newer)',
    ].join('\n')

    const initial = upsertRecent('RECENT.md', olderEntry, {
      maxSessions: 3,
      maxLines: 500,
    })
    const updated = upsertRecent(
      'RECENT.md',
      newerEntry,
      { maxSessions: 3, maxLines: 500 },
      initial,
    )

    const entries = extractRecentEntries(updated.split('\n'))
    expect(entries[0]).toContain('## Session 2026-05-21 10:00')
    expect(entries[1]).toContain('## Session 2026-05-20 10:00')
  })

  test('retains at least the configured number of meaningful entries when possible', () => {
    const sparse1 = [
      '## Session 2026-05-20 10:00 (1m)',
      '',
      '**Source**: NOW session',
      '',
      'No summary available.',
      '**Link**: [Full details](MEMORY-2026-05-20.md#s1)',
    ].join('\n')

    const sparse2 = [
      '## Session 2026-05-19 10:00 (1m)',
      '',
      '**Source**: NOW session',
      '',
      'No summary available.',
      '**Link**: [Full details](MEMORY-2026-05-19.md#s2)',
    ].join('\n')

    const rich3 = [
      '## Recall Import 2026-05-18 10:00 (1m)',
      '',
      '**Source**: Imported OpenCode summary',
      '',
      'Researching ML tools for astrophotography.',
      '',
      '**Decisions**:',
      '- Use GraXpert.',
      '**Link**: [Full details](MEMORY-2026-05-18.md#s3)',
    ].join('\n')

    const rich4 = [
      '## Recall Import 2026-05-17 10:00 (1m)',
      '',
      '**Source**: Imported OpenCode summary',
      '',
      'Investigating Siril automation scripts.',
      '',
      '**Decisions**:',
      '- Script plate solving.',
      '**Link**: [Full details](MEMORY-2026-05-17.md#s4)',
    ].join('\n')

    const rich5 = [
      '## Task 2026-05-16 10:00 (1m)',
      '',
      '**Source**: Task history',
      '',
      'Building summary command.',
      '',
      '**Decisions**:',
      '- Parse entries structurally.',
      '**Link**: [Full details](MEMORY-2026-05-16.md#s5)',
    ].join('\n')

    const rich6 = [
      '## Task 2026-05-15 10:00 (1m)',
      '',
      '**Source**: Task history',
      '',
      'Expanding cold-start memory briefings with index fallback.',
      '',
      '**Discoveries**:',
      '- The memory index must be sorted by timestamp for fallback.',
      '**Link**: [Full details](MEMORY-2026-05-15.md#s6)',
    ].join('\n')

    let recent = upsertRecent('RECENT.md', sparse1, {
      maxSessions: 4,
      maxLines: 500,
    })
    recent = upsertRecent(
      'RECENT.md',
      sparse2,
      { maxSessions: 4, maxLines: 500 },
      recent,
    )
    recent = upsertRecent(
      'RECENT.md',
      rich3,
      { maxSessions: 4, maxLines: 500 },
      recent,
    )
    recent = upsertRecent(
      'RECENT.md',
      rich4,
      { maxSessions: 4, maxLines: 500 },
      recent,
    )
    recent = upsertRecent(
      'RECENT.md',
      rich5,
      { maxSessions: 4, maxLines: 500 },
      recent,
    )
    recent = upsertRecent(
      'RECENT.md',
      rich6,
      { maxSessions: 4, maxLines: 500 },
      recent,
    )

    const entries = extractRecentEntries(recent.split('\n'))
    // Should have 4 meaningful entries, swapping out the sparse ones.
    const meaningfulCount = entries.filter(isMeaningfulEntry).length
    expect(meaningfulCount).toBeGreaterThanOrEqual(4)
  })
})
