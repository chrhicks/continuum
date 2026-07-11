import type { DbHandle } from '../../db/client'

export type RecallStatus = {
  sources: number
  messages: number
  summaries: number
}

export function getRecallStatus(handle: DbHandle): RecallStatus {
  return handle.sqlite
    .query(
      `SELECT
       (SELECT COUNT(*) FROM memory_recall_sources) sources,
       (SELECT COUNT(*) FROM memory_recall_messages) messages,
       (SELECT COUNT(*) FROM memory_recall_summaries) summaries`,
    )
    .get() as RecallStatus
}
