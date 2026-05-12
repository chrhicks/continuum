import { type MemorySearchTier } from '../../../memory/search'
import { type RetrievalSearchSource } from '../../../memory/retrieval/search'
import { type RecallSearchMode } from '../../../recall/search'
import { parseOptionalPositiveInteger, parsePositiveInteger } from '../shared'

const DEFAULT_SYNC_PROCESSED_VERSION = 1

function createRecallPositiveIntegerParser(
  defaultValue: number,
  errorMessage: string,
): (value?: string) => number
function createRecallPositiveIntegerParser(
  defaultValue: null,
  errorMessage: string,
): (value?: string) => number | null
function createRecallPositiveIntegerParser(
  defaultValue: number | null,
  errorMessage: string,
): (value?: string) => number | null {
  return (value?: string) => {
    if (defaultValue === null) {
      return parseOptionalPositiveInteger(value, null, errorMessage)
    }
    return parseOptionalPositiveInteger(value, defaultValue, errorMessage)
  }
}

const parseRecallLimitValue = createRecallPositiveIntegerParser(
  5,
  'Limit must be a positive integer.',
)
const parseDiffLimitValue = createRecallPositiveIntegerParser(
  10,
  'Limit must be a positive integer.',
)
const parseSyncLimitValue = createRecallPositiveIntegerParser(
  null,
  'Limit must be a positive integer.',
)
const parseProcessedVersionValue = createRecallPositiveIntegerParser(
  DEFAULT_SYNC_PROCESSED_VERSION,
  'Processed version must be a positive integer.',
)

export function parseSearchTier(value: string): MemorySearchTier | 'all' {
  const normalized = value.toUpperCase()
  if (
    normalized === 'NOW' ||
    normalized === 'RECENT' ||
    normalized === 'MEMORY'
  ) {
    return normalized
  }
  if (normalized === 'ALL') {
    return 'all'
  }
  throw new Error('Invalid tier. Use: NOW, RECENT, MEMORY, or all.')
}

export function parseSearchTags(value: string): string[] {
  const tags = value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
  if (tags.length === 0) {
    throw new Error(
      'Missing tags. Use: continuum memory search <query> --tags tag1,tag2',
    )
  }
  return tags
}

export function parseSearchSource(value: string): RetrievalSearchSource {
  const normalized = value.trim().toLowerCase()
  if (
    normalized === 'memory' ||
    normalized === 'recall' ||
    normalized === 'all'
  ) {
    return normalized
  }
  throw new Error('Invalid source. Use: memory, recall, or all.')
}

export function parseAfterDate(value: string): Date {
  const parsedMs = Date.parse(value)
  if (Number.isNaN(parsedMs)) {
    throw new Error(
      'Invalid --after date. Use an ISO date like 2026-02-25 or 2026-02-25T12:00:00Z.',
    )
  }
  return new Date(parsedMs)
}

export function parseTail(value: string): number {
  return parsePositiveInteger(value, 'Tail count must be a positive integer.')
}

export function parseSearchLimit(value: string): number {
  return parsePositiveInteger(value, 'Limit must be a positive integer.')
}

export function parseHours(value: string): number {
  const hours = Number(value)
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error('Hours must be a positive number.')
  }
  return hours
}

export function parseRecallMode(value?: string): RecallSearchMode {
  if (!value) return 'auto'
  const normalized = value.toLowerCase()
  if (
    normalized === 'bm25' ||
    normalized === 'semantic' ||
    normalized === 'auto'
  ) {
    return normalized
  }
  throw new Error('Invalid mode. Use: bm25, semantic, or auto.')
}

export function parseRecallLimit(value?: string): number {
  return parseRecallLimitValue(value)
}

export function parseDiffLimit(value?: string): number {
  return parseDiffLimitValue(value)
}

export function parseSyncLimit(value?: string): number | null {
  return parseSyncLimitValue(value)
}

export function parseProcessedVersion(value?: string): number {
  return parseProcessedVersionValue(value)
}
