import { describe, expect, test } from 'bun:test'
import { renderConsolidationArtifacts } from '../src/memory/consolidation/render'
import type { PreparedConsolidationInput } from '../src/memory/domain/projection-input'
import type { MemorySummary } from '../src/memory/types'

const summary: MemorySummary = {
  narrative: 'Projection narrative',
  decisions: ['Use canonical SQLite.'],
  discoveries: [],
  patterns: [],
  whatWorked: [],
  whatFailed: [],
  blockers: [],
  openQuestions: [],
  nextSteps: [],
  tasks: [],
  files: ['src/memory/application/consolidate.ts'],
  confidence: 'high',
}

describe('consolidation projection rendering', () => {
  test('renders linked RECENT, daily MEMORY, and index projections', () => {
    const input: PreparedConsolidationInput = {
      record: {
        id: 'record',
        source: 'now',
        kind: 'session',
        externalId: 'session-id',
        projectId: null,
        workspaceRoot: null,
        title: null,
        body: 'raw body',
        createdAt: '2026-07-10T10:00:00.000Z',
        updatedAt: '2026-07-10T10:05:00.000Z',
        references: { tags: [], taskIds: [], filePaths: [] },
        metadata: {},
        fingerprint: 'fingerprint',
      },
      sourcePath: 'SQLite/1-2',
      sessionId: 'session-id',
      timestampStart: new Date('2026-07-10T10:00:00.000Z'),
      timestampEnd: new Date('2026-07-10T10:05:00.000Z'),
      durationMinutes: 5,
      tags: [],
      precomputedSummary: summary,
      clearSourceAfterPersist: false,
    }
    const rendered = renderConsolidationArtifacts({
      input,
      summary,
      config: {
        now_max_lines: 200,
        now_max_hours: 6,
        recent_session_count: 3,
        recent_max_lines: 500,
        memory_sections: ['Architecture Decisions', 'Sessions'],
      },
    })
    const anchor = 'session-2026-07-10-10-00-session-id'
    expect(rendered.updatedRecent).toContain(`#${anchor}`)
    expect(rendered.updatedMemory).toContain(`<a name="${anchor}"></a>`)
    expect(rendered.updatedMemory).toContain('Use canonical SQLite.')
    expect(rendered.updatedIndex).toContain(`#${anchor}`)
  })
})
