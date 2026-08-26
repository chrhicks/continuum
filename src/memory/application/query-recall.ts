import type { Database } from 'bun:sqlite'
import { Schema } from 'effect'
import { DecodeError } from '../domain/errors'
import { MemorySummarySchema } from '../domain/memory-summary'
import type { MemoryEvidence } from './query'

const CanonicalRecallSummary = Schema.Struct({
  focus: Schema.String,
  decisions: Schema.Array(Schema.String),
  discoveries: Schema.Array(Schema.String),
  patterns: Schema.Array(Schema.String),
  tasks: Schema.Array(Schema.String),
  files: Schema.Array(Schema.String),
  blockers: Schema.Array(Schema.String),
  open_questions: Schema.Array(Schema.String),
  next_steps: Schema.Array(Schema.String),
  confidence: Schema.Literals(['low', 'medium', 'high']),
})
const RecallSummarySchema = Schema.Union([
  MemorySummarySchema,
  CanonicalRecallSummary,
])

type StoredRecallEvidence = {
  type: 'recall-message' | 'recall-summary'
  id: string
  content: string
  created_at: string | null
  session_id: string
  current: number
}

export function loadCurrentRecallEvidence(sqlite: Database): MemoryEvidence[] {
  return loadRecallEvidence(sqlite, true)
}

export function loadRecallHistoryEvidence(sqlite: Database): MemoryEvidence[] {
  return loadRecallEvidence(sqlite, false)
}

function loadRecallEvidence(
  sqlite: Database,
  selectCurrent: boolean,
): MemoryEvidence[] {
  const rows = sqlite
    .query(
      `SELECT type, id, content, created_at, session_id, current FROM (
         SELECT 'recall-message' type, m.id, m.content,
                COALESCE(m.created_at,s.source_created_at) created_at,
                s.external_session_id session_id,
                m.source_fingerprint = s.fingerprint current
         FROM memory_recall_messages m
         JOIN memory_recall_sources s ON s.id=m.source_id
         UNION ALL
         SELECT 'recall-summary', r.id, r.summary, r.created_at,
                s.external_session_id,
                r.source_fingerprint = s.fingerprint
         FROM memory_recall_summaries r
         JOIN memory_recall_sources s ON s.id=r.source_id
       ) WHERE current = ?`,
    )
    .all(selectCurrent ? 1 : 0) as StoredRecallEvidence[]

  return rows.map((row) => {
    const derived = row.type === 'recall-summary'
    return {
      type: row.type,
      provenance: derived ? 'derived' : 'raw',
      id: row.id,
      content: derived ? flattenRecallSummary(row.content) : row.content,
      createdAt: row.created_at,
      source: `opencode session ${row.session_id}${selectCurrent ? '' : ' (historical)'}`,
      tags: [],
      current: selectCurrent,
    }
  })
}

function flattenRecallSummary(value: string): string {
  let summary: typeof RecallSummarySchema.Type
  try {
    summary = Schema.decodeUnknownSync(RecallSummarySchema)(JSON.parse(value))
  } catch (cause) {
    throw new DecodeError({ schema: 'RecallSummary', cause })
  }
  if ('narrative' in summary) {
    return [
      summary.narrative,
      ...summary.decisions,
      ...summary.discoveries,
      ...summary.patterns,
      ...summary.whatWorked,
      ...summary.whatFailed,
      ...summary.blockers,
      ...summary.openQuestions,
      ...summary.nextSteps,
      ...summary.tasks,
      ...summary.files,
    ].join('\n')
  }
  return [
    summary.focus,
    ...summary.decisions,
    ...summary.discoveries,
    ...summary.patterns,
    ...summary.tasks,
    ...summary.files,
    ...summary.blockers,
    ...summary.open_questions,
    ...summary.next_steps,
  ].join('\n')
}
