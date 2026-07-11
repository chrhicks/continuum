import type { CollectedRecord, MemorySummary } from '../types'

export type PreparedConsolidationInput = {
  record: CollectedRecord
  sourcePath: string
  sessionId: string
  timestampStart: Date
  timestampEnd: Date
  durationMinutes: number
  tags: string[]
  frontmatter?: Record<string, unknown>
  frontmatterKeys?: string[]
  body?: string
  precomputedSummary?: MemorySummary
  clearSourceAfterPersist?: boolean
}
