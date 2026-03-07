import { createHash } from 'node:crypto'
import type {
  CollectedRecord,
  MemoryRecordKind,
  MemoryRecordReferences,
  MemorySource,
} from '../types'
import type { MemoryCheckpoint } from '../state/types'

const TASK_ID_PATTERN = /\btkt[-_][a-zA-Z0-9_-]+\b/g
const FILE_PATH_PATTERN =
  /\b[\w./-]+\.(ts|tsx|js|jsx|json|md|yaml|yml|sql|sh|go|py|rs)\b/gi

export type MemoryCollectorOptions = {
  limit?: number | null
  checkpoint?: MemoryCheckpoint | null
}

export type MemoryCollectorResult = {
  records: CollectedRecord[]
  checkpoint?: MemoryCheckpoint | null
}

export interface MemoryCollector {
  readonly source: MemorySource
  collect(options?: MemoryCollectorOptions): Promise<MemoryCollectorResult>
}

export type CollectedRecordInput = {
  id?: string
  source: MemorySource
  kind: MemoryRecordKind
  externalId: string
  projectId?: string | null
  workspaceRoot?: string | null
  title?: string | null
  body: string
  createdAt?: string | null
  updatedAt?: string | null
  references?: Partial<MemoryRecordReferences>
  metadata?: Record<string, unknown>
  fingerprint?: string | null
}

export function buildCollectedRecord(
  input: CollectedRecordInput,
): CollectedRecord {
  const references = normalizeRecordReferences(input.references)
  const metadata = { ...(input.metadata ?? {}) }
  const id = input.id ?? `${input.source}:${input.externalId}`

  return {
    id,
    source: input.source,
    kind: input.kind,
    externalId: input.externalId,
    projectId: input.projectId ?? null,
    workspaceRoot: input.workspaceRoot ?? null,
    title: normalizeOptionalString(input.title),
    body: input.body.trim(),
    createdAt: normalizeOptionalString(input.createdAt),
    updatedAt: normalizeOptionalString(input.updatedAt),
    references,
    metadata,
    fingerprint:
      normalizeOptionalString(input.fingerprint) ??
      buildCollectedRecordFingerprint({
        id,
        source: input.source,
        kind: input.kind,
        externalId: input.externalId,
        projectId: input.projectId ?? null,
        workspaceRoot: input.workspaceRoot ?? null,
        title: input.title ?? null,
        body: input.body,
        createdAt: input.createdAt ?? null,
        updatedAt: input.updatedAt ?? null,
        references,
        metadata,
      }),
  }
}

export function normalizeRecordReferences(
  value?: Partial<MemoryRecordReferences>,
): MemoryRecordReferences {
  return {
    tags: normalizeStringList(value?.tags),
    taskIds: normalizeStringList(value?.taskIds),
    filePaths: normalizeStringList(value?.filePaths),
  }
}

export function normalizeStringList(
  value: Iterable<unknown> | null | undefined,
): string[] {
  if (!value) {
    return []
  }
  const items: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      continue
    }
    const trimmed = item.trim()
    if (trimmed.length === 0) {
      continue
    }
    items.push(trimmed)
  }
  return Array.from(new Set(items)).sort((left, right) =>
    left.localeCompare(right),
  )
}

export function extractTaskIdsFromText(body: string): string[] {
  return normalizeStringList(body.match(TASK_ID_PATTERN) ?? [])
}

export function extractFilePathsFromText(body: string): string[] {
  return normalizeStringList(body.match(FILE_PATH_PATTERN) ?? [])
}

export function buildCollectedRecordFingerprint(input: {
  id: string
  source: MemorySource
  kind: MemoryRecordKind
  externalId: string
  projectId: string | null
  workspaceRoot: string | null
  title: string | null
  body: string
  createdAt: string | null
  updatedAt: string | null
  references: MemoryRecordReferences
  metadata: Record<string, unknown>
}): string {
  return createHash('sha256')
    .update(
      stableStringify({
        id: input.id,
        source: input.source,
        kind: input.kind,
        externalId: input.externalId,
        projectId: input.projectId,
        workspaceRoot: input.workspaceRoot,
        title: input.title,
        body: input.body.trim(),
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        references: input.references,
        metadata: input.metadata,
      }),
    )
    .digest('hex')
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item))
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, sortValue(entryValue)]),
  )
}
