import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { createLlmClient } from '../../llm/client'
import {
  buildCollectedRecordFingerprint,
  type MemoryCollectorOptions,
} from './base'
import {
  type NormalizedOpencodeMessage,
  type ResolvedSummaryConfig,
} from './opencode-artifacts'
import {
  collectSessionArtifacts,
  createOpencodeCollectionAccumulator,
} from './opencode-collection-helpers'
import { resolveSummaryConfig } from './opencode-summary-config'
import type { CollectedRecord } from '../types'
import { createCheckpointInput } from '../state/file-repository'
import type { MemoryCheckpoint } from '../state/types'
import type { MemoryStateRepository } from '../state/repository'
import {
  extractOpencodeSessions,
  type OpencodeSessionBundle,
} from '../opencode/extract'
import type { RecallSummaryResult } from '../opencode/summary-schema'

export type OpencodeCollectionOptions = MemoryCollectorOptions & {
  repoPath?: string | null
  dbPath?: string | null
  outDir?: string | null
  projectId?: string | null
  sessionId?: string | null
  summarize?: boolean
  summaryModel?: string | null
  summaryApiKey?: string | null
  summaryApiUrl?: string | null
  summaryMaxTokens?: number | null
  summaryTimeoutMs?: number | null
  summaryMaxChars?: number | null
  summaryMaxLines?: number | null
  summaryMergeMaxEstTokens?: number | null
}

export type OpencodeCollectionResult = {
  dbPath: string
  repoPath: string
  outDir: string
  projectId: string
  sessionsProcessed: number
  summarizedSessions: number
  records: CollectedRecord[]
  checkpoint: MemoryCheckpoint | null
  artifacts: {
    normalized: string[]
    summaries: string[]
    summaryMeta: string[]
  }
}

type OpencodeCollectionDependencies = {
  llmClientFactory?: typeof createLlmClient
  stateRepository?: MemoryStateRepository
  summarizeSession?: (
    session: OpencodeSessionBundle,
    messages: NormalizedOpencodeMessage[],
    config: ResolvedSummaryConfig,
  ) => Promise<RecallSummaryResult>
}

export async function collectOpencodeRecords(
  options: OpencodeCollectionOptions = {},
  dependencies: OpencodeCollectionDependencies = {},
): Promise<OpencodeCollectionResult> {
  const extraction = extractOpencodeSessions({
    repoPath: options.repoPath ?? null,
    dbPath: options.dbPath ?? null,
    outDir: options.outDir ?? null,
    projectId: options.projectId ?? null,
    sessionId: options.sessionId ?? null,
    limit: options.limit ?? null,
  })
  const outDir = extraction.outDir
  mkdirSync(outDir, { recursive: true })

  const summaryConfig = resolveSummaryConfig(options)
  const shouldSummarize = options.summarize ?? summaryConfig !== null
  if (shouldSummarize && !summaryConfig) {
    throw new Error(
      'Missing OpenCode summary configuration. Set summary API key and model via flags, memory config, or environment variables.',
    )
  }

  const accumulator = createOpencodeCollectionAccumulator()

  for (const session of extraction.sessions) {
    await collectSessionArtifacts({
      session,
      projectId: extraction.project.id,
      workspaceRootFallback: extraction.project.worktree ?? extraction.repoPath,
      outDir,
      shouldSummarize,
      summaryConfig,
      summarizeSessionOverride: dependencies.summarizeSession,
      llmClientFactory: dependencies.llmClientFactory,
      accumulator,
    })
  }

  const checkpoint = dependencies.stateRepository
    ? dependencies.stateRepository.putCheckpoint(
        createCheckpointInput({
          source: 'opencode',
          scope: `project:${extraction.project.id}`,
          cursor: extraction.sessions[0]?.session.id ?? null,
          fingerprint: buildCheckpointFingerprint(accumulator.records),
          recordCount: accumulator.records.length,
          metadata: {
            repoPath: extraction.repoPath,
            outDir,
            summarizedSessions: accumulator.summaryPaths.length,
          },
        }),
      )
    : null

  return {
    dbPath: extraction.dbPath,
    repoPath: extraction.repoPath,
    outDir,
    projectId: extraction.project.id,
    sessionsProcessed: extraction.sessions.length,
    summarizedSessions: accumulator.summaryPaths.length,
    records: accumulator.records,
    checkpoint,
    artifacts: {
      normalized: accumulator.normalizedPaths,
      summaries: accumulator.summaryPaths,
      summaryMeta: accumulator.summaryMetaPaths,
    },
  }
}

function buildCheckpointFingerprint(records: CollectedRecord[]): string {
  return createHash('sha256')
    .update(records.map((record) => record.fingerprint).join('|'))
    .digest('hex')
}
