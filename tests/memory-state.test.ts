import { describe, expect, test } from 'bun:test'

import {
  createInMemoryMemoryStateRepository,
  createMemoryCheckpointKey,
} from '../src/memory/state/repository'

describe('memory state repository', () => {
  test('stores and retrieves checkpoints by source and scope', () => {
    const repository = createInMemoryMemoryStateRepository()

    const checkpoint = repository.putCheckpoint({
      source: 'opencode',
      scope: 'repo:/workspace/app',
      cursor: 'ses_123',
      fingerprint: 'abc123',
      recordCount: 4,
      updatedAt: '2026-03-07T22:00:00.000Z',
      metadata: { projectId: 'proj_1' },
    })

    expect(checkpoint.key).toBe(
      createMemoryCheckpointKey('opencode', 'repo:/workspace/app'),
    )
    expect(
      repository.getCheckpoint('opencode', 'repo:/workspace/app')?.cursor,
    ).toBe('ses_123')
  })

  test('lists and deletes checkpoints deterministically', () => {
    const repository = createInMemoryMemoryStateRepository()
    repository.putCheckpoint({ source: 'task', scope: 'repo:/a' })
    repository.putCheckpoint({ source: 'opencode', scope: 'repo:/a' })

    expect(repository.listCheckpoints().map((entry) => entry.key)).toEqual([
      'opencode:repo:/a',
      'task:repo:/a',
    ])

    repository.deleteCheckpoint('task', 'repo:/a')

    expect(repository.getCheckpoint('task', 'repo:/a')).toBeNull()
    expect(repository.listCheckpoints('opencode')).toHaveLength(1)
  })
})
