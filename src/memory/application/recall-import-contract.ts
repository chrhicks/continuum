import { Schema } from 'effect'
import type {
  NormalizedOpencodeMessage,
  ResolvedSummaryConfig,
} from '../collectors/opencode-artifacts'
import type {
  OpencodeExtractionResult,
  OpencodeSessionBundle,
  extractOpencodeSessions,
} from '../opencode/extract'
import type { RecallSummaryResult } from '../opencode/summary-schema'
import type { RecallRepositoryService } from '../repository/recall-repository'

export type RecallImportRequest = {
  readonly dbPath?: string
  readonly projectId?: string
  readonly sessionId?: string
  readonly limit?: number
  readonly afterDate?: Date
  readonly dryRun?: boolean
}

export type RecallImportDependencyOverrides = {
  readonly summaryConfig?: ResolvedSummaryConfig
  readonly summarize?: RecallSessionSummarizer
  readonly now?: () => Date
  readonly extract?: typeof extractOpencodeSessions
}

export type RecallImportDependencies = {
  readonly repository: RecallRepositoryService
  readonly summaryConfig: ResolvedSummaryConfig | null
  readonly summarize: RecallSessionSummarizer
  readonly now: () => Date
}

export type PreparedRecallImport = {
  readonly request: RecallImportRequest
  readonly extraction: OpencodeExtractionResult
  readonly dependencies: RecallImportDependencies
}

export type RecallSessionSummarizer = (
  session: OpencodeSessionBundle,
  messages: NormalizedOpencodeMessage[],
  config: ResolvedSummaryConfig,
) => Promise<RecallSummaryResult>

const RecallSessionImportOutcomeSchema = Schema.Struct({
  sessionId: Schema.String,
  status: Schema.Literals([
    'current',
    'would-import',
    'would-refresh',
    'imported',
    'refreshed',
  ]),
})

export interface RecallSessionImportOutcome extends Schema.Schema.Type<
  typeof RecallSessionImportOutcomeSchema
> {}

export class RecallImportExecutionError extends Schema.TaggedError<RecallImportExecutionError>()(
  'RecallImportExecutionError',
  {
    completedOutcomes: Schema.Array(RecallSessionImportOutcomeSchema),
    failedSessionId: Schema.String,
    unattemptedSessionIds: Schema.Array(Schema.String),
    cause: Schema.Defect(),
  },
) {}

export type CanonicalRecallImportResult = {
  readonly sourceDbPath: string
  readonly dryRun: boolean
  readonly totalSessions: number
  readonly imported: number
  readonly changed: number
  readonly skippedExisting: number
  readonly importedSessions: string[]
  readonly sessionOutcomes: RecallSessionImportOutcome[]
}

export function buildCanonicalRecallImportResult(
  sourceDbPath: string,
  dryRun: boolean,
  totalSessions: number,
  sessionOutcomes: RecallSessionImportOutcome[],
): CanonicalRecallImportResult {
  let imported = 0
  let changed = 0
  let skippedExisting = 0
  const importedSessions: string[] = []
  for (const outcome of sessionOutcomes) {
    if (outcome.status === 'current') {
      skippedExisting += 1
      continue
    }
    importedSessions.push(outcome.sessionId)
    if (outcome.status === 'imported' || outcome.status === 'would-import')
      imported += 1
    else changed += 1
  }
  return {
    sourceDbPath,
    dryRun,
    totalSessions,
    imported,
    changed,
    skippedExisting,
    importedSessions,
    sessionOutcomes,
  }
}
