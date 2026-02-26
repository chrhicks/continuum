import { type MemorySearchTier } from '../../../memory/search'
import { parsePositiveInteger } from '../shared'

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

export function parseHours(value: string): number {
  const hours = Number(value)
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error('Hours must be a positive number.')
  }
  return hours
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return 'n/a'
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const rounded = Math.round(value * 10) / 10
  return `${rounded} ${units[unitIndex]}`
}

export function formatAgeMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) {
    return 'n/a'
  }
  if (minutes < 60) {
    return `${minutes}m`
  }
  if (minutes < 60 * 24) {
    return `${Math.round(minutes / 60)}h`
  }
  return `${Math.round(minutes / (60 * 24))}d`
}
