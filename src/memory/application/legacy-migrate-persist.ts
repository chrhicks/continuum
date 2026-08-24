import type { Database } from 'bun:sqlite'
import { basename } from 'node:path'
import type { DbHandle } from '../../db/client'
import { parseFrontmatter } from '../../utils/frontmatter'
import { parseOpencodeSummary } from '../opencode/summary-parse'
import type { MemorySummary } from '../types'
import {
  fingerprint,
  LEGACY_MIGRATION_VERSION,
  migrationKey,
  normalizePath,
  readSessionId,
  type LegacyArtifact,
} from './legacy-migrate-artifacts'
import { hasCompletedRun, recordCompletedRun } from './legacy-migrate-run'
export function persistLegacyArtifacts(
  handle: DbHandle,
  artifacts: LegacyArtifact[],
): boolean {
  const sqlite = handle.sqlite
  return sqlite
    .transaction(() => {
      if (hasCompletedRun(sqlite)) return false
      for (const artifact of artifacts) {
        const canonicalId =
          artifact.result === 'import' ? importArtifact(sqlite, artifact) : null
        sqlite
          .query(
            `INSERT OR IGNORE INTO memory_legacy_migrations
             (source_path, checksum, migration_version, artifact_kind,
              import_result, canonical_id, detail, imported_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            normalizePath(artifact.path),
            artifact.checksum,
            LEGACY_MIGRATION_VERSION,
            artifact.kind,
            artifact.result,
            canonicalId,
            artifact.detail,
            new Date().toISOString(),
          )
      }
      recordCompletedRun(sqlite, artifacts)
      return true
    })
    .immediate()
}

function importArtifact(sqlite: Database, artifact: LegacyArtifact): string {
  if (artifact.kind === 'opencode-summary')
    return importRecallSummary(sqlite, artifact)
  if (artifact.kind === 'opencode-normalized')
    return importTranscript(sqlite, artifact)
  return importJournalArtifact(sqlite, artifact)
}

function importJournalArtifact(
  sqlite: Database,
  artifact: LegacyArtifact,
): string {
  const parsed = parseFrontmatter(artifact.content)
  const identity = stableId('legacy-journal', migrationKey(artifact))
  const createdAt = artifactDate(artifact) ?? new Date().toISOString()
  const idempotencyKey = [
    'legacy',
    LEGACY_MIGRATION_VERSION,
    normalizePath(artifact.path),
    artifact.checksum,
  ].join(':')
  sqlite
    .query(
      `INSERT OR IGNORE INTO memory_journal_entries
       (id, kind, content, source, idempotency_key, metadata,
        payload_version, created_at)
       VALUES (?, 'agent', ?, 'legacy-markdown', ?, ?, 1, ?)`,
    )
    .run(
      identity,
      parsed.body.trim(),
      idempotencyKey,
      JSON.stringify({
        sourcePath: normalizePath(artifact.path),
        legacyKind: artifact.kind,
        migrationVersion: LEGACY_MIGRATION_VERSION,
      }),
      createdAt,
    )
  if (artifact.kind === 'now') return identity
  const row = sqlite
    .query('SELECT sequence FROM memory_journal_entries WHERE id = ?')
    .get(identity) as { sequence: number }
  const consolidationId = stableId(
    'legacy-consolidation',
    migrationKey(artifact),
  )
  sqlite
    .query(
      `INSERT OR IGNORE INTO memory_consolidations
       (id, first_sequence, last_sequence, status, summary, summary_version,
        model, created_at, completed_at)
       VALUES (?, ?, ?, 'completed', ?, 1, 'legacy-markdown', ?, ?)`,
    )
    .run(
      consolidationId,
      row.sequence,
      row.sequence,
      JSON.stringify(summaryFrom(parsed.body)),
      createdAt,
      createdAt,
    )
  return consolidationId
}

function importRecallSummary(
  sqlite: Database,
  artifact: LegacyArtifact,
): string {
  const parsed = parseOpencodeSummary(artifact.content)
  if (!parsed) throw new Error(`Invalid OpenCode summary: ${artifact.path}`)
  const sourceFingerprint = fingerprint(`legacy\0${parsed.sessionId}`)
  const sourceId = upsertRecallSource(sqlite, {
    sessionId: parsed.sessionId,
    projectId: parsed.projectId,
    title: parsed.title,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    checksum: sourceFingerprint,
  })
  const id = stableId('legacy-summary', migrationKey(artifact))
  const body = cleanSummaryBody(parseFrontmatter(artifact.content).body)
  sqlite
    .query(
      `INSERT OR IGNORE INTO memory_recall_summaries
       (id, source_id, summary, summary_version, model,
        source_fingerprint, created_at)
       VALUES (?, ?, ?, 1, 'legacy-markdown-summary-only', ?, ?)`,
    )
    .run(
      id,
      sourceId,
      JSON.stringify({
        ...summaryFrom(body),
        decisions: parsed.decisions,
        discoveries: parsed.discoveries,
        patterns: parsed.patterns,
        blockers: parsed.blockers,
        openQuestions: parsed.openQuestions,
        nextSteps: parsed.nextSteps,
        tasks: parsed.tasks,
        files: parsed.files,
        confidence: parsed.confidence,
      }),
      sourceFingerprint,
      parsed.updatedAt,
    )
  return id
}

function importTranscript(sqlite: Database, artifact: LegacyArtifact): string {
  const frontmatter = parseFrontmatter(artifact.content).frontmatter
  const sessionId = readSessionId(artifact.content)
  if (!sessionId) throw new Error('Missing transcript session ID')
  const sourceFingerprint = fingerprint(`legacy\0${sessionId}`)
  const sourceId = upsertRecallSource(sqlite, {
    sessionId,
    projectId: readString(frontmatter.project_id),
    title: readString(frontmatter.title),
    createdAt: readString(frontmatter.created_at),
    updatedAt: readString(frontmatter.updated_at),
    checksum: sourceFingerprint,
  })
  const messages = parseNormalizedMessages(artifact.content)
  const insert = sqlite.query(
    `INSERT OR IGNORE INTO memory_recall_messages
     (id, source_id, source_fingerprint, ordinal, role, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  messages.forEach((message, ordinal) =>
    insert.run(
      `${sourceId}:legacy-message:${ordinal}`,
      sourceId,
      sourceFingerprint,
      ordinal,
      message.role,
      message.content,
      message.createdAt,
    ),
  )
  return sourceId
}

function upsertRecallSource(
  sqlite: Database,
  source: {
    sessionId: string
    projectId: string | null
    title: string | null
    createdAt: string | null
    updatedAt: string | null
    checksum: string
  },
): string {
  const existing = sqlite
    .query(
      "SELECT id FROM memory_recall_sources WHERE harness='opencode' AND external_session_id=?",
    )
    .get(source.sessionId) as { id: string } | null
  const sourceId =
    existing?.id ?? stableId('legacy-opencode-source', source.sessionId)
  const now = new Date().toISOString()
  sqlite
    .query(
      `INSERT INTO memory_recall_sources
       (id, harness, external_project_id, external_session_id, title,
        source_created_at, source_updated_at, fingerprint,
        first_ingested_at, last_ingested_at)
       VALUES (?, 'opencode', ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(harness, external_session_id) DO UPDATE SET
         external_project_id=COALESCE(excluded.external_project_id, external_project_id),
         title=COALESCE(excluded.title, title),
         source_created_at=COALESCE(excluded.source_created_at, source_created_at),
         source_updated_at=COALESCE(excluded.source_updated_at, source_updated_at),
         fingerprint=excluded.fingerprint, last_ingested_at=excluded.last_ingested_at`,
    )
    .run(
      sourceId,
      source.projectId,
      source.sessionId,
      source.title,
      source.createdAt,
      source.updatedAt,
      source.checksum,
      now,
      now,
    )
  return sourceId
}

function parseNormalizedMessages(content: string): Array<{
  role: 'user' | 'assistant'
  content: string
  createdAt: string | null
}> {
  const body = parseFrontmatter(content).body
  const matches = [
    ...body.matchAll(
      /^### (User|Agent)(?: \(([^)]+)\))?\s*\n+([\s\S]*?)(?=^### |(?![\s\S]))/gm,
    ),
  ]
  return matches.map((match) => ({
    role: match[1] === 'User' ? 'user' : 'assistant',
    createdAt: readTimestamp(match[2]),
    content: (match[3] ?? '').trim(),
  }))
}

function cleanSummaryBody(body: string): string {
  return body
    .trim()
    .replace(/^# Session Summary:.*\n+/i, '')
    .trim()
}

function summaryFrom(content: string): MemorySummary {
  return {
    narrative: content.trim(),
    decisions: [],
    discoveries: [],
    patterns: [],
    whatWorked: [],
    whatFailed: [],
    blockers: [],
    openQuestions: [],
    nextSteps: [],
    tasks: [],
    files: [],
    confidence: null,
  }
}

function artifactDate(artifact: LegacyArtifact): string | null {
  const match = basename(artifact.absolutePath).match(/(\d{4}-\d{2}-\d{2})/)
  return match?.[1] ? `${match[1]}T00:00:00.000Z` : null
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${fingerprint(value).slice(0, 32)}`
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readTimestamp(value: string | undefined): string | null {
  return value && !Number.isNaN(Date.parse(value)) ? value : null
}
