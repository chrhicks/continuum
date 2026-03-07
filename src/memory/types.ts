export type MemorySource = 'opencode' | 'task' | 'now'

export type MemoryRecordKind = 'session' | 'summary' | 'task' | 'note'

export type MemoryTier = 'now' | 'recent' | 'memory'

export type MemoryConfidence = 'low' | 'medium' | 'high'

export type MemoryRecordReferences = {
  tags: string[]
  taskIds: string[]
  filePaths: string[]
}

export type CollectedRecord = {
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
  fingerprint: string
}

export type MemorySummary = {
  narrative: string
  decisions: string[]
  discoveries: string[]
  patterns: string[]
  whatWorked: string[]
  whatFailed: string[]
  blockers: string[]
  openQuestions: string[]
  nextSteps: string[]
  tasks: string[]
  files: string[]
  confidence: MemoryConfidence | null
}

export type ConsolidatedEntry = {
  id: string
  source: MemorySource | 'mixed'
  sourceIds: string[]
  title: string | null
  timeRange: {
    start: string | null
    end: string | null
  }
  summary: MemorySummary
  references: MemoryRecordReferences
  metadata: Record<string, unknown>
}

export type RetrievalDocument = {
  id: string
  tier: MemoryTier
  source: MemorySource | 'mixed'
  title: string | null
  body: string
  references: MemoryRecordReferences
  updatedAt: string | null
  metadata: Record<string, unknown>
}
