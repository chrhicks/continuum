import type { MemorySource } from '../types'
import type { MemoryCheckpoint, MemoryCheckpointInput } from './types'

export interface MemoryStateRepository {
  getCheckpoint(source: MemorySource, scope: string): MemoryCheckpoint | null
  putCheckpoint(input: MemoryCheckpointInput): MemoryCheckpoint
  listCheckpoints(source?: MemorySource): MemoryCheckpoint[]
  deleteCheckpoint(source: MemorySource, scope: string): void
}

export function createMemoryCheckpointKey(
  source: MemorySource,
  scope: string,
): string {
  return `${source}:${scope}`
}

export function createInMemoryMemoryStateRepository(
  initial: MemoryCheckpoint[] = [],
): MemoryStateRepository {
  const checkpoints = new Map<string, MemoryCheckpoint>()
  for (const checkpoint of initial) {
    checkpoints.set(checkpoint.key, checkpoint)
  }

  return {
    getCheckpoint(source, scope) {
      return checkpoints.get(createMemoryCheckpointKey(source, scope)) ?? null
    },

    putCheckpoint(input) {
      const key = createMemoryCheckpointKey(input.source, input.scope)
      const checkpoint: MemoryCheckpoint = {
        key,
        source: input.source,
        scope: input.scope,
        cursor: input.cursor ?? null,
        fingerprint: input.fingerprint ?? null,
        recordCount: input.recordCount ?? 0,
        updatedAt: input.updatedAt ?? new Date().toISOString(),
        metadata: { ...(input.metadata ?? {}) },
      }
      checkpoints.set(key, checkpoint)
      return checkpoint
    },

    listCheckpoints(source) {
      return Array.from(checkpoints.values())
        .filter((checkpoint) => (source ? checkpoint.source === source : true))
        .sort((left, right) => left.key.localeCompare(right.key))
    },

    deleteCheckpoint(source, scope) {
      checkpoints.delete(createMemoryCheckpointKey(source, scope))
    },
  }
}
