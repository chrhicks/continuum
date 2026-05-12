import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildOpencodeArtifactFilename,
  type OpencodeArtifactKind,
} from '../opencode/paths'
import type { RecallSummaryResult } from '../opencode/summary-schema'
import type { OpencodeSessionBundle } from '../opencode/extract'
import type { CollectedRecord } from '../types'
import {
  buildNormalizedSessionDoc,
  buildOpencodeRecallSummary,
  buildSummaryDoc,
  buildSummaryMeta,
  normalizeSummary,
  toIso,
  type NormalizedOpencodeMessage,
  type ResolvedSummaryConfig,
} from './opencode-artifacts'
import {
  buildNormalizedTranscript,
  normalizeSessionMessages,
} from './opencode-message-normalization'
import {
  normalizeOpencodeSessionRecord,
  normalizeOpencodeSummaryRecord,
} from './index'
import {
  countSummaryChunks,
  summarizeOpencodeSession,
} from './opencode-summary'

export type OpencodeCollectionAccumulator = {
  records: CollectedRecord[]
  normalizedPaths: string[]
  summaryPaths: string[]
  summaryMetaPaths: string[]
}

type CollectSessionArtifactsInput = {
  session: OpencodeSessionBundle
  projectId: string
  workspaceRootFallback: string
  outDir: string
  shouldSummarize: boolean
  summaryConfig: ResolvedSummaryConfig | null
  summarizeSessionOverride?: (
    session: OpencodeSessionBundle,
    messages: NormalizedOpencodeMessage[],
    config: ResolvedSummaryConfig,
  ) => Promise<RecallSummaryResult>
  llmClientFactory?: typeof import('../../llm/client').createLlmClient
  accumulator: OpencodeCollectionAccumulator
}

export function createOpencodeCollectionAccumulator(): OpencodeCollectionAccumulator {
  return {
    records: [],
    normalizedPaths: [],
    summaryPaths: [],
    summaryMetaPaths: [],
  }
}

export async function collectSessionArtifacts(
  input: CollectSessionArtifactsInput,
): Promise<void> {
  const normalizedMessages = normalizeSessionMessages(
    input.session.messageBlocks,
  )
  const sessionRecord = buildSessionRecord(
    input.session,
    input.projectId,
    input.workspaceRootFallback,
    normalizedMessages,
  )
  input.accumulator.records.push(sessionRecord)
  input.accumulator.normalizedPaths.push(
    writeOpencodeArtifact(
      input.outDir,
      'normalized',
      input.session,
      buildNormalizedSessionDoc(
        input.session,
        input.projectId,
        normalizedMessages,
      ),
    ),
  )

  if (!input.shouldSummarize || !input.summaryConfig) {
    return
  }
  const summaryConfig = input.summaryConfig

  await collectSummaryArtifacts(
    input,
    normalizedMessages,
    summaryConfig,
    sessionRecord.references.filePaths,
  )
}

async function collectSummaryArtifacts(
  input: CollectSessionArtifactsInput,
  normalizedMessages: NormalizedOpencodeMessage[],
  summaryConfig: ResolvedSummaryConfig,
  allowedFiles: string[],
): Promise<void> {
  const summaryChunkCount = countSummaryChunks(
    normalizedMessages,
    summaryConfig,
  )
  const summary = input.summarizeSessionOverride
    ? await input.summarizeSessionOverride(
        input.session,
        normalizedMessages,
        summaryConfig,
      )
    : await summarizeOpencodeSession(
        input.session,
        normalizedMessages,
        summaryConfig,
        input.llmClientFactory,
      )
  const normalizedSummary = normalizeSummary(summary, allowedFiles)
  input.accumulator.summaryPaths.push(
    writeOpencodeArtifact(
      input.outDir,
      'summary',
      input.session,
      buildSummaryDoc(
        input.session,
        input.projectId,
        normalizedSummary,
        summaryConfig,
        summaryChunkCount,
      ),
    ),
  )
  input.accumulator.summaryMetaPaths.push(
    writeOpencodeArtifact(
      input.outDir,
      'summaryMeta',
      input.session,
      `${JSON.stringify(
        buildSummaryMeta(
          input.session,
          input.projectId,
          normalizedSummary,
          summaryConfig,
          summaryChunkCount,
        ),
        null,
        2,
      )}\n`,
    ),
  )
  input.accumulator.records.push(
    normalizeOpencodeSummaryRecord(
      buildOpencodeRecallSummary(
        input.session,
        input.projectId,
        normalizedSummary,
      ),
    ),
  )
}

function buildSessionRecord(
  session: OpencodeSessionBundle,
  projectId: string,
  workspaceRootFallback: string,
  normalizedMessages: NormalizedOpencodeMessage[],
): CollectedRecord {
  return normalizeOpencodeSessionRecord({
    sessionId: session.session.id,
    projectId,
    workspaceRoot: session.session.directory ?? workspaceRootFallback,
    title: session.session.title ?? session.session.slug ?? session.session.id,
    transcript: buildNormalizedTranscript(normalizedMessages),
    createdAt: toIso(session.session.time?.created),
    updatedAt: toIso(session.session.time?.updated),
    tags: ['opencode'],
    metadata: {
      project_id: projectId,
      slug: session.session.slug ?? null,
    },
  })
}

function writeOpencodeArtifact(
  outDir: string,
  kind: OpencodeArtifactKind,
  session: OpencodeSessionBundle,
  content: string,
): string {
  const path = join(
    outDir,
    buildOpencodeArtifactFilename(
      kind,
      session.session.time?.created,
      session.session.id,
    ),
  )
  writeFileSync(path, content, 'utf-8')
  return path
}
