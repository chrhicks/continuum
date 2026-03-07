import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { MemorySource } from '../types'
import type { MemoryStateRepository } from './repository'
import {
  createInMemoryMemoryStateRepository,
  createMemoryCheckpointKey,
} from './repository'
import type { MemoryCheckpoint, MemoryCheckpointInput } from './types'

type StoredMemoryState = {
  checkpoints: MemoryCheckpoint[]
}

export function createFileMemoryStateRepository(
  filePath: string,
): MemoryStateRepository {
  return {
    getCheckpoint(source, scope) {
      return readRepository(filePath).getCheckpoint(source, scope)
    },

    putCheckpoint(input) {
      const repository = readRepository(filePath)
      const checkpoint = repository.putCheckpoint(input)
      persistRepository(filePath, repository.listCheckpoints())
      return checkpoint
    },

    listCheckpoints(source) {
      return readRepository(filePath).listCheckpoints(source)
    },

    deleteCheckpoint(source, scope) {
      const repository = readRepository(filePath)
      repository.deleteCheckpoint(source, scope)
      persistRepository(filePath, repository.listCheckpoints())
    },
  }
}

export function readCheckpointFile(filePath: string): MemoryCheckpoint[] {
  if (!existsSync(filePath)) {
    return []
  }
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as StoredMemoryState
    if (!raw || !Array.isArray(raw.checkpoints)) {
      return []
    }
    return raw.checkpoints
      .map((checkpoint) => normalizeCheckpoint(checkpoint))
      .filter(
        (checkpoint): checkpoint is MemoryCheckpoint => checkpoint !== null,
      )
  } catch {
    return []
  }
}

function readRepository(filePath: string) {
  return createInMemoryMemoryStateRepository(readCheckpointFile(filePath))
}

function persistRepository(
  filePath: string,
  checkpoints: MemoryCheckpoint[],
): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const payload: StoredMemoryState = { checkpoints }
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
}

function normalizeCheckpoint(value: unknown): MemoryCheckpoint | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const checkpoint = value as Record<string, unknown>
  const source = checkpoint.source
  const scope = checkpoint.scope
  if (
    (source !== 'opencode' && source !== 'task' && source !== 'now') ||
    typeof scope !== 'string' ||
    scope.trim().length === 0
  ) {
    return null
  }

  return {
    key:
      typeof checkpoint.key === 'string' && checkpoint.key.trim().length > 0
        ? checkpoint.key
        : createMemoryCheckpointKey(source, scope),
    source,
    scope,
    cursor: typeof checkpoint.cursor === 'string' ? checkpoint.cursor : null,
    fingerprint:
      typeof checkpoint.fingerprint === 'string'
        ? checkpoint.fingerprint
        : null,
    recordCount:
      typeof checkpoint.recordCount === 'number' &&
      Number.isFinite(checkpoint.recordCount)
        ? checkpoint.recordCount
        : 0,
    updatedAt:
      typeof checkpoint.updatedAt === 'string' &&
      checkpoint.updatedAt.trim().length > 0
        ? checkpoint.updatedAt
        : new Date().toISOString(),
    metadata:
      checkpoint.metadata && typeof checkpoint.metadata === 'object'
        ? { ...(checkpoint.metadata as Record<string, unknown>) }
        : {},
  }
}

export function createCheckpointInput(options: {
  source: MemorySource
  scope: string
  cursor?: string | null
  fingerprint?: string | null
  recordCount?: number
  metadata?: Record<string, unknown>
}): MemoryCheckpointInput {
  return {
    source: options.source,
    scope: options.scope,
    cursor: options.cursor ?? null,
    fingerprint: options.fingerprint ?? null,
    recordCount: options.recordCount ?? 0,
    updatedAt: new Date().toISOString(),
    metadata: { ...(options.metadata ?? {}) },
  }
}
