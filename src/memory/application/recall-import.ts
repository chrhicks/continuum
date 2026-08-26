import { createHash } from 'node:crypto'
import { Effect, Result } from 'effect'
import {
  extractOpencodeSessions,
  type OpencodeExtractionResult,
  type OpencodeSessionBundle,
} from '../opencode/extract'
import { normalizeSessionMessages } from '../collectors/opencode-message-normalization'
import { resolveSummaryConfig } from '../collectors/opencode-summary-config'
import { summarizeOpencodeSession } from '../collectors/opencode-summary'
import type { NormalizedOpencodeMessage } from '../collectors/opencode-artifacts'
import { makeRecallRepository } from '../repository/recall-repository'
import { RecallSourceError, RecallSummaryError } from '../domain/errors'
import { loadMemoryConfig } from '../config'
import type { MemoryResourceOwner } from './resource-owner'
import {
  buildCanonicalRecallImportResult,
  RecallImportExecutionError,
  type CanonicalRecallImportResult,
  type PreparedRecallImport,
  type RecallImportDependencies,
  type RecallImportDependencyOverrides,
  type RecallImportRequest,
  type RecallSessionImportOutcome,
} from './recall-import-contract'

export {
  RecallImportExecutionError,
  type CanonicalRecallImportResult,
  type PreparedRecallImport,
  type RecallImportDependencies,
  type RecallImportDependencyOverrides,
  type RecallImportRequest,
  type RecallSessionImportOutcome,
} from './recall-import-contract'

export function importCanonicalOpencodeRecall(
  owner: MemoryResourceOwner,
  request: RecallImportRequest = {},
  dependencyOverrides: RecallImportDependencyOverrides = {},
): Effect.Effect<CanonicalRecallImportResult, unknown> {
  return prepareCanonicalRecallImport(owner, request, dependencyOverrides).pipe(
    Effect.flatMap(executeCanonicalRecallImport),
    Effect.mapError((error) =>
      error instanceof RecallImportExecutionError ? error.cause : error,
    ),
  )
}

export function prepareCanonicalRecallImport(
  owner: MemoryResourceOwner,
  request: RecallImportRequest = {},
  overrides: RecallImportDependencyOverrides = {},
): Effect.Effect<PreparedRecallImport, unknown> {
  return Effect.gen(function* () {
    const extraction = yield* extractRecallSource(
      request,
      owner.workspaceRoot,
      overrides.extract ?? extractOpencodeSessions,
    )
    const summaryConfig =
      overrides.summaryConfig ??
      resolveSummaryConfig(yield* loadMemoryConfig(owner.memoryDir))
    return {
      request,
      extraction,
      dependencies: {
        repository: makeRecallRepository(owner.handle),
        summaryConfig,
        summarize: overrides.summarize ?? summarizeOpencodeSession,
        now: overrides.now ?? (() => new Date()),
      },
    }
  })
}

export function executeCanonicalRecallImport(
  prepared: PreparedRecallImport,
): Effect.Effect<CanonicalRecallImportResult, RecallImportExecutionError> {
  const { request, extraction, dependencies } = prepared
  return Effect.gen(function* () {
    const sessions = selectRequestedSessions(extraction.sessions, request)
    const sessionOutcomes = yield* importRecallSessions(
      sessions,
      extraction.project.id,
      request,
      dependencies,
    )
    return buildCanonicalRecallImportResult(
      extraction.dbPath,
      request.dryRun ?? false,
      sessions.length,
      sessionOutcomes,
    )
  })
}

function extractRecallSource(
  request: RecallImportRequest,
  workspaceRoot: string,
  extract: typeof extractOpencodeSessions,
): Effect.Effect<OpencodeExtractionResult, RecallSourceError> {
  return Effect.try({
    try: () =>
      extract({
        dbPath: request.dbPath,
        repoPath: workspaceRoot,
        projectId: request.projectId,
        sessionId: request.sessionId,
        afterDate: request.afterDate,
        limit: request.limit,
      }),
    catch: (cause) => new RecallSourceError({ cause }),
  })
}

function selectRequestedSessions(
  sessions: OpencodeSessionBundle[],
  request: RecallImportRequest,
): OpencodeSessionBundle[] {
  const filtered = sessions.filter((session) =>
    isAfter(session, request.afterDate),
  )
  return typeof request.limit === 'number'
    ? filtered.slice(0, request.limit)
    : filtered
}

function isAfter(session: OpencodeSessionBundle, afterDate?: Date): boolean {
  const created = session.session.time?.created
  return (
    !afterDate || typeof created !== 'number' || created >= afterDate.getTime()
  )
}

function importRecallSessions(
  sessions: readonly OpencodeSessionBundle[],
  projectId: string,
  request: RecallImportRequest,
  dependencies: RecallImportDependencies,
): Effect.Effect<RecallSessionImportOutcome[], RecallImportExecutionError> {
  return Effect.gen(function* () {
    const completedOutcomes: RecallSessionImportOutcome[] = []
    for (const [index, session] of sessions.entries()) {
      const attempt = yield* Effect.result(
        importRecallSession(session, projectId, request, dependencies),
      )
      if (Result.isFailure(attempt)) {
        return yield* Effect.fail(
          new RecallImportExecutionError({
            completedOutcomes,
            failedSessionId: session.session.id,
            unattemptedSessionIds: sessions
              .slice(index + 1)
              .map((item) => item.session.id),
            cause: attempt.failure,
          }),
        )
      }
      completedOutcomes.push(attempt.success)
    }
    return completedOutcomes
  })
}

function isRecallMessage(
  message: NormalizedOpencodeMessage,
): message is NormalizedOpencodeMessage & { role: 'user' | 'assistant' } {
  return message.role === 'user' || message.role === 'assistant'
}

function importRecallSession(
  session: OpencodeSessionBundle,
  projectId: string,
  request: RecallImportRequest,
  dependencies: RecallImportDependencies,
): Effect.Effect<RecallSessionImportOutcome, unknown> {
  return Effect.gen(function* () {
    const sessionId = session.session.id
    const messages = normalizeSessionMessages(session.messageBlocks).filter(
      isRecallMessage,
    )
    const fingerprint = fingerprintSession(session, projectId, messages)
    const existing = yield* dependencies.repository.findSource(
      'opencode',
      sessionId,
    )
    if (existing?.fingerprint === fingerprint)
      return sessionOutcome(sessionId, 'current')
    if (request.dryRun)
      return sessionOutcome(
        sessionId,
        existing ? 'would-refresh' : 'would-import',
      )
    const config = dependencies.summaryConfig
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
      try: () => dependencies.summarize(session, messages, config),
      catch: (cause) => new RecallSummaryError({ cause }),
    })
    const timestamp = dependencies.now().toISOString()
    const sourceId = existing?.id ?? `recall_opencode_${sessionId}`
    yield* dependencies.repository.replace({
      source: {
        id: sourceId,
        harness: 'opencode',
        externalProjectId: projectId,
        externalSessionId: sessionId,
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
        role: message.role,
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
    return sessionOutcome(sessionId, existing ? 'refreshed' : 'imported')
  })
}

function sessionOutcome(
  sessionId: string,
  status: RecallSessionImportOutcome['status'],
): RecallSessionImportOutcome {
  return { sessionId, status }
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
