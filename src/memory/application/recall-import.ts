import { createHash } from 'node:crypto'
import { Effect } from 'effect'
import { getWorkspaceContext } from '../paths'
import {
  extractOpencodeSessions,
  type OpencodeSessionBundle,
} from '../opencode/extract'
import { normalizeSessionMessages } from '../collectors/opencode-message-normalization'
import { resolveSummaryConfig } from '../collectors/opencode-summary-config'
import { summarizeOpencodeSession } from '../collectors/opencode-summary'
import type {
  NormalizedOpencodeMessage,
  ResolvedSummaryConfig,
} from '../collectors/opencode-artifacts'
import type { RecallSummaryResult } from '../opencode/summary-schema'
import {
  recallRepositoryForPath,
  type RecallRepositoryService,
} from '../repository/recall-repository'
import { RecallSourceError, RecallSummaryError } from '../domain/errors'

export type CanonicalRecallImportOptions = {
  continuumDbPath?: string
  dbPath?: string
  repoPath?: string
  projectId?: string
  sessionId?: string
  limit?: number
  afterDate?: Date
  dryRun?: boolean
  repository?: RecallRepositoryService
  summaryConfig?: ResolvedSummaryConfig
  summarize?: (
    session: OpencodeSessionBundle,
    messages: NormalizedOpencodeMessage[],
    config: ResolvedSummaryConfig,
  ) => Promise<RecallSummaryResult>
  now?: () => Date
  extract?: typeof extractOpencodeSessions
}

export type CanonicalRecallImportResult = {
  sourceDbPath: string
  dryRun: boolean
  totalSessions: number
  imported: number
  changed: number
  skippedExisting: number
  importedSessions: string[]
}

export function importCanonicalOpencodeRecall(
  options: CanonicalRecallImportOptions = {},
): Effect.Effect<CanonicalRecallImportResult, unknown> {
  return Effect.gen(function* () {
    const workspace =
      options.repoPath && options.continuumDbPath ? null : getWorkspaceContext()
    const extraction = yield* Effect.try({
      try: () =>
        (options.extract ?? extractOpencodeSessions)({
          dbPath: options.dbPath,
          repoPath: options.repoPath ?? workspace!.workspaceRoot,
          projectId: options.projectId,
          sessionId: options.sessionId,
          afterDate: options.afterDate,
          limit: options.limit,
        }),
      catch: (cause) => new RecallSourceError({ cause }),
    })
    const repository =
      options.repository ??
      recallRepositoryForPath(
        options.continuumDbPath ?? workspace!.continuumDbPath,
      )
    const config = options.summaryConfig ?? resolveSummaryConfig({})
    const sessions = applySessionFilters(
      extraction.sessions,
      options.afterDate,
      options.limit,
    )
    const result: CanonicalRecallImportResult = {
      sourceDbPath: extraction.dbPath,
      dryRun: options.dryRun ?? false,
      totalSessions: sessions.length,
      imported: 0,
      changed: 0,
      skippedExisting: 0,
      importedSessions: [],
    }
    for (const session of sessions) {
      yield* importSession(
        session,
        extraction.project.id,
        repository,
        config,
        options,
        result,
      )
    }
    return result
  })
}

function applySessionFilters(
  sessions: OpencodeSessionBundle[],
  afterDate?: Date,
  limit?: number,
): OpencodeSessionBundle[] {
  const filtered = sessions.filter((session) => isAfter(session, afterDate))
  return typeof limit === 'number' ? filtered.slice(0, limit) : filtered
}

function isAfter(session: OpencodeSessionBundle, afterDate?: Date): boolean {
  const created = session.session.time?.created
  return (
    !afterDate || typeof created !== 'number' || created >= afterDate.getTime()
  )
}

function importSession(
  session: OpencodeSessionBundle,
  projectId: string,
  repository: RecallRepositoryService,
  config: ResolvedSummaryConfig | null,
  options: CanonicalRecallImportOptions,
  result: CanonicalRecallImportResult,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const messages = normalizeSessionMessages(session.messageBlocks).filter(
      (message) => message.role === 'user' || message.role === 'assistant',
    )
    const fingerprint = fingerprintSession(session, projectId, messages)
    const existing = yield* repository.findSource(
      'opencode',
      session.session.id,
    )
    if (existing?.fingerprint === fingerprint) {
      result.skippedExisting += 1
      return
    }
    if (options.dryRun) {
      existing ? (result.changed += 1) : (result.imported += 1)
      result.importedSessions.push(session.session.id)
      return
    }
    if (!config) {
      return yield* Effect.fail(
        new RecallSummaryError({
          cause: new Error(
            'Missing OpenCode summary configuration. Set summary API key and model via memory config or environment variables.',
          ),
        }),
      )
    }
    const summary = yield* Effect.tryPromise({
      try: () =>
        (options.summarize ?? summarizeOpencodeSession)(
          session,
          messages,
          config,
        ),
      catch: (cause) => new RecallSummaryError({ cause }),
    })
    const timestamp = (options.now ?? (() => new Date()))().toISOString()
    const sourceId = existing?.id ?? `recall_opencode_${session.session.id}`
    yield* repository.replace({
      source: {
        id: sourceId,
        harness: 'opencode',
        externalProjectId: projectId,
        externalSessionId: session.session.id,
        title: session.session.title ?? session.session.slug ?? null,
        sourceCreatedAt: toIso(session.session.time?.created),
        sourceUpdatedAt: toIso(session.session.time?.updated),
        fingerprint,
        firstIngestedAt: existing?.firstIngestedAt ?? timestamp,
        lastIngestedAt: timestamp,
      },
      messages: messages.map((message, ordinal) => ({
        id: `${sourceId}:message:${fingerprint}:${ordinal}`,
        sourceId,
        sourceFingerprint: fingerprint,
        ordinal,
        role: message.role as 'user' | 'assistant',
        content: message.text,
        createdAt: message.createdAt,
      })),
      summary: {
        id: `${sourceId}:summary`,
        sourceId,
        summary,
        summaryVersion: 1,
        model: config.model,
        sourceFingerprint: fingerprint,
        createdAt: timestamp,
      },
    })
    existing ? (result.changed += 1) : (result.imported += 1)
    result.importedSessions.push(session.session.id)
  })
}

function fingerprintSession(
  session: OpencodeSessionBundle,
  projectId: string,
  messages: readonly NormalizedOpencodeMessage[],
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        session: session.session.id,
        projectId,
        title: session.session.title ?? null,
        updated: session.session.time?.updated ?? null,
        messages: messages.map(({ id, role, createdAt, text }) => ({
          id,
          role,
          createdAt,
          text,
        })),
      }),
    )
    .digest('hex')
}

function toIso(value?: number): string | null {
  return typeof value === 'number' ? new Date(value).toISOString() : null
}
