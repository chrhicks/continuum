import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildOpencodeArtifactFilename,
  type OpencodeArtifactKind,
} from '../opencode/paths'
import { parseOpencodeSummary } from '../opencode/summary-parse'
import { parseFrontmatter } from '../../utils/frontmatter'
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
  const summaryPath = join(
    input.outDir,
    buildOpencodeArtifactFilename(
      'summary',
      input.session.session.time?.created,
      input.session.session.id,
    ),
  )

  let summary: RecallSummaryResult
  let summaryChunkCount: number

  if (existsSync(summaryPath)) {
    const title =
      input.session.session.title ??
      input.session.session.slug ??
      input.session.session.id
    console.error(`[collect] Reusing existing summary for ${title}`)
    const content = readFileSync(summaryPath, 'utf-8')
    const parsed = parseOpencodeSummary(content)
    if (!parsed) {
      throw new Error(`Failed to parse existing summary: ${summaryPath}`)
    }
    summary = {
      focus: parsed.focus,
      decisions: parsed.decisions,
      discoveries: parsed.discoveries,
      patterns: parsed.patterns,
      tasks: parsed.tasks,
      files: parsed.files,
      blockers: parsed.blockers,
      open_questions: parsed.openQuestions,
      next_steps: parsed.nextSteps,
      confidence:
        parsed.confidence === 'medium'
          ? 'med'
          : (parsed.confidence ?? 'low'),
    }
    const { frontmatter } = parseFrontmatter(content)
    summaryChunkCount =
      typeof frontmatter.summary_chunks === 'number'
        ? frontmatter.summary_chunks
        : 0
  } else {
    summaryChunkCount = countSummaryChunks(normalizedMessages, summaryConfig)
    const cacheDir = join(input.outDir, '.chunks')
    summary = input.summarizeSessionOverride
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
          cacheDir,
        )
    if (existsSync(cacheDir)) {
      try {
        rmSync(cacheDir, { recursive: true, force: true })
      } catch {
        // ignore cleanup failures
      }
    }
  }

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
