import type { Database } from 'bun:sqlite'
import { Schema } from 'effect'
import { DecodeError } from '../domain/errors'
import { JournalMetadata } from '../domain/journal-entry'
import { MemorySummarySchema } from '../domain/memory-summary'
import type { MemoryEvidence } from './query'

type StoredJournalEvidence = {
  id: string
  content: string
  created_at: string
  source: string | null
  metadata: string
}

export function loadJournalEvidence(sqlite: Database): MemoryEvidence[] {
  const boundary = (
    sqlite
      .query(
        "SELECT COALESCE(MAX(last_sequence), 0) boundary FROM memory_consolidations WHERE status='completed'",
      )
      .get() as { boundary: number }
  ).boundary
  const rows = sqlite
    .query(
      `SELECT id, content, created_at, source, metadata
       FROM memory_journal_entries WHERE sequence > ? ORDER BY sequence DESC`,
    )
    .all(boundary) as StoredJournalEvidence[]

  return rows.map((row) => {
    const metadata = decodeJson(
      JournalMetadata,
      row.metadata ?? '{}',
      'JournalMetadata',
    )
    return {
      type: 'journal',
      provenance: 'raw',
      id: row.id,
      content: row.content,
      createdAt: row.created_at,
      source: row.source ?? 'journal',
      tags: [...(metadata.tags ?? [])],
      current: true,
    }
  })
}

export function loadConsolidationEvidence(sqlite: Database): MemoryEvidence[] {
  const rows = sqlite
    .query(
      `SELECT id, summary, completed_at FROM memory_consolidations
       WHERE status='completed' ORDER BY completed_at DESC`,
    )
    .all() as Array<{ id: string; summary: string; completed_at: string }>

  return rows.map((row) => {
    const summary = decodeJson(
      MemorySummarySchema,
      row.summary,
      'MemorySummary',
    )
    return {
      type: 'consolidation',
      provenance: 'derived',
      id: row.id,
      content: formatSummary(summary),
      createdAt: row.completed_at,
      source: 'journal consolidation',
      tags: [],
      current: true,
    }
  })
}

function decodeJson<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: string,
  name: string,
): S['Type'] {
  try {
    return Schema.decodeUnknownSync(schema)(JSON.parse(value))
  } catch (cause) {
    throw new DecodeError({ schema: name, cause })
  }
}

function formatSummary(summary: typeof MemorySummarySchema.Type): string {
  const lines = [summary.narrative]
  appendSummaryItems(lines, 'Decisions', summary.decisions)
  appendSummaryItems(lines, 'Discoveries', summary.discoveries)
  appendSummaryItems(lines, 'Patterns', summary.patterns)
  appendSummaryItems(lines, 'What Worked', summary.whatWorked)
  appendSummaryItems(lines, 'What Failed', summary.whatFailed)
  appendSummaryItems(lines, 'Blockers', summary.blockers)
  appendSummaryItems(lines, 'Open Questions', summary.openQuestions)
  appendSummaryItems(lines, 'Next Steps', summary.nextSteps)
  appendSummaryItems(lines, 'Tasks', summary.tasks)
  appendSummaryItems(lines, 'Files', summary.files)
  return lines.filter(Boolean).join('\n\n')
}

function appendSummaryItems(
  lines: string[],
  title: string,
  items: readonly string[],
): void {
  if (items.length === 0) return
  lines.push(`**${title}**\n${items.map((item) => `- ${item}`).join('\n')}`)
}
