import type { MemoryResourceOwner } from './resource-owner'

export type RecallStatus = {
  sources: number
  messages: number
  summaries: number
}

export function getRecallStatus(owner: MemoryResourceOwner): RecallStatus {
  return owner.handle.sqlite
    .query(
      `SELECT
       (SELECT COUNT(*) FROM memory_recall_sources) sources,
       (SELECT COUNT(*) FROM memory_recall_messages) messages,
       (SELECT COUNT(*) FROM memory_recall_summaries) summaries`,
    )
    .get() as RecallStatus
}
