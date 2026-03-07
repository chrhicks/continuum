import type { MemorySource } from '../types'

export type MemoryCheckpoint = {
  key: string
  source: MemorySource
  scope: string
  cursor: string | null
  fingerprint: string | null
  recordCount: number
  updatedAt: string
  metadata: Record<string, unknown>
}

export type MemoryCheckpointInput = {
  source: MemorySource
  scope: string
  cursor?: string | null
  fingerprint?: string | null
  recordCount?: number
  updatedAt?: string
  metadata?: Record<string, unknown>
}
