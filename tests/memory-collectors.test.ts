import { describe, expect, test } from 'bun:test'

import {
  normalizeNowRecord,
  normalizeOpencodeSummaryRecord,
  normalizeTaskRecord,
} from '../src/memory/collectors'
import type { Task } from '../src/task/types'

const BASE_TASK: Task = {
  id: 'tkt-test123',
  title: 'Normalize task memory inputs',
  type: 'feature',
  status: 'open',
  priority: 10,
  intent: 'Unify task-shaped memory records',
  description: 'Capture task details into the shared memory model.',
  plan: '1) Add types 2) Add collectors',
  steps: [
    {
      id: 1,
      title: 'Add types',
      description: 'Introduce shared memory contracts',
      status: 'completed',
      position: 1,
      summary: 'Done',
      details: undefined,
      notes: null,
    },
  ],
  current_step: null,
  discoveries: [
    {
      id: 1,
      content: 'Task notes already contain structured learnings.',
      source: 'agent',
      impact: null,
      created_at: '2026-03-07T22:00:00.000Z',
    },
  ],
  decisions: [
    {
      id: 1,
      content: 'Normalize tasks through a collector.',
      rationale:
        'the consolidation pipeline should not care about source shape',
      source: 'agent',
      impact: null,
      created_at: '2026-03-07T21:59:00.000Z',
    },
  ],
  outcome: null,
  completed_at: null,
  parent_id: null,
  blocked_by: ['tkt-parent01'],
  created_at: '2026-03-07T21:58:00.000Z',
  updated_at: '2026-03-07T22:01:00.000Z',
}

describe('memory collector normalization', () => {
  test('normalizes NOW sessions into collected records', () => {
    const record = normalizeNowRecord({
      sessionId: 'sess_123',
      body: [
        'Goal alignment: unify memory collection.',
        'Changes: src/memory/types.ts, src/memory/collectors/index.ts',
        'Task: tkt-test123',
      ].join('\n'),
      workspaceRoot: '/repo',
      projectPath: '/repo',
      createdAt: '2026-03-07T22:10:00.000Z',
      tags: ['memory', 'collectors'],
      relatedTasks: ['tkt-test123'],
    })

    expect(record.source).toBe('now')
    expect(record.kind).toBe('session')
    expect(record.workspaceRoot).toBe('/repo')
    expect(record.references.tags).toEqual(['collectors', 'memory'])
    expect(record.references.taskIds).toEqual(['tkt-test123'])
    expect(record.references.filePaths).toEqual([
      'src/memory/collectors/index.ts',
      'src/memory/types.ts',
    ])
    expect(record.fingerprint).toHaveLength(64)
  })

  test('normalizes OpenCode summaries into collected records', () => {
    const record = normalizeOpencodeSummaryRecord({
      sessionId: 'ses_abc',
      projectId: 'proj_123',
      createdAt: '2026-03-07T20:00:00.000Z',
      updatedAt: '2026-03-07T21:00:00.000Z',
      directory: '/repo',
      title: 'Memory refactor',
      focus: 'Unify memory collection.',
      decisions: ['Use one collected record shape.'],
      discoveries: ['The CLI already knows the target workspace.'],
      patterns: [
        'Keep deterministic extraction separate from LLM summarization.',
      ],
      blockers: [],
      openQuestions: [
        'Should retrieval search raw recall and materialized memory together?',
      ],
      nextSteps: ['Wire collected records into consolidation.'],
      tasks: ['tkt-test123'],
      files: ['src/memory/types.ts'],
      confidence: 'high',
    })

    expect(record.source).toBe('opencode')
    expect(record.kind).toBe('summary')
    expect(record.projectId).toBe('proj_123')
    expect(record.references.tags).toEqual(['opencode', 'recall'])
    expect(record.references.taskIds).toEqual(['tkt-test123'])
    expect(record.references.filePaths).toEqual(['src/memory/types.ts'])
    expect(record.body).toContain('Focus: Unify memory collection.')
  })

  test('normalizes tasks into collected records with stable fingerprints', () => {
    const first = normalizeTaskRecord(BASE_TASK, { workspaceRoot: '/repo' })
    const second = normalizeTaskRecord(BASE_TASK, { workspaceRoot: '/repo' })

    expect(first.source).toBe('task')
    expect(first.kind).toBe('task')
    expect(first.references.tags).toEqual(['feature', 'open'])
    expect(first.references.taskIds).toEqual(['tkt-parent01', 'tkt-test123'])
    expect(first.body).toContain('Decisions:')
    expect(first.body).toContain('Discoveries:')
    expect(first.fingerprint).toBe(second.fingerprint)
  })
})
