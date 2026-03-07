import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLlmClient } from '../../llm/client'
import type { LlmClient } from '../../llm/client'
import { serializeFrontmatter } from '../../utils/frontmatter'
import { getMemoryConfig } from '../config'
import {
  buildCollectedRecordFingerprint,
  type MemoryCollectorOptions,
} from './base'
import {
  normalizeOpencodeSessionRecord,
  normalizeOpencodeSummaryRecord,
} from './index'
import type { CollectedRecord } from '../types'
import { createCheckpointInput } from '../state/file-repository'
import type { MemoryCheckpoint } from '../state/types'
import type { MemoryStateRepository } from '../state/repository'
import {
  extractOpencodeSessions,
  type OpencodeExtractionOptions,
  type OpencodeMessageBlock,
  type OpencodeSessionBundle,
} from '../../recall/opencode/extract'
import {
  buildOpencodeArtifactFilename,
  type OpencodeArtifactKind,
} from '../../recall/opencode/paths'
import {
  buildRecallSummaryItem,
  mergeRecallSummaryItems,
} from '../../recall/opencode/summary-merge'
import {
  parseRecallSummaryJson,
  type RecallSummaryConfidence,
  type RecallSummaryResult,
  RECALL_SUMMARY_JSON_SCHEMA,
} from '../../recall/opencode/summary-schema'
import { planRecallSummaryChunks } from '../../recall/opencode/summary-chunks'
import type { OpencodeRecallSummary } from '../../recall/opencode/summary-parse'

const DEFAULT_SUMMARY_API_URL = 'https://opencode.ai/zen/v1/chat/completions'
const DEFAULT_SUMMARY_MAX_TOKENS = 4000
const DEFAULT_SUMMARY_TIMEOUT_MS = 120000
const DEFAULT_SUMMARY_MAX_CHARS = 40000
const DEFAULT_SUMMARY_MAX_LINES = 1200
const DEFAULT_SUMMARY_MERGE_MAX_EST_TOKENS = 12000

const SUMMARY_CHUNK_PROMPT = `You are summarizing a chunk of an OpenCode session transcript.

Return JSON only. Do not include markdown, backticks, or code fences.
Use only facts explicitly stated in the chunk. Do not infer or invent.

Field requirements:
- focus: one concise sentence describing the main intent of the chunk.
- decisions: only explicit decisions or commitments that were agreed, confirmed, or executed in the chunk.
- discoveries: factual findings explicitly stated.
- patterns: recurring practices or conventions explicitly described.
- tasks: explicit action items or work described as done or to-do in the chunk.
- files: only file paths explicitly mentioned.
- blockers: explicit blockers or constraints stated.
- open_questions: explicit questions or missing info requested.
- next_steps: explicit next actions stated.
- confidence: low | med | high.

If a field is unknown or empty, use an empty string (focus only) or empty array.
Return JSON matching this schema exactly:
${JSON.stringify(RECALL_SUMMARY_JSON_SCHEMA)}`

const SUMMARY_MERGE_PROMPT = `You merge multiple chunk summaries into one session summary.

Return JSON only. Do not include markdown, backticks, or code fences.
Use only facts present in the provided chunk summaries. Do not add new facts.

Merge rules:
- De-duplicate list items; keep the most specific version.
- If items conflict, prefer the most recent or surface the uncertainty in open_questions.
- Do not reclassify proposals or suggestions as decisions.
- Keep only durable, high-signal items worth remembering later.

Return JSON matching this schema exactly:
${JSON.stringify(RECALL_SUMMARY_JSON_SCHEMA)}`

type NormalizedOpencodeMessage = {
  id: string
  role: string
  createdAt: string | null
  text: string
}

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

type ResolvedSummaryConfig = {
  apiUrl: string
  apiKey: string
  model: string
  maxTokens: number
  timeoutMs: number
  maxChars: number
  maxLines: number
  mergeMaxEstTokens: number
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

  const records: CollectedRecord[] = []
  const normalizedPaths: string[] = []
  const summaryPaths: string[] = []
  const summaryMetaPaths: string[] = []

  for (const session of extraction.sessions) {
    const normalizedMessages = normalizeSessionMessages(session.messageBlocks)
    const transcript = buildNormalizedTranscript(normalizedMessages)
    const sessionRecord = normalizeOpencodeSessionRecord({
      sessionId: session.session.id,
      projectId: extraction.project.id,
      workspaceRoot:
        session.session.directory ??
        extraction.project.worktree ??
        extraction.repoPath,
      title:
        session.session.title ?? session.session.slug ?? session.session.id,
      transcript,
      createdAt: toIso(session.session.time?.created),
      updatedAt: toIso(session.session.time?.updated),
      tags: ['opencode'],
      metadata: {
        project_id: extraction.project.id,
        slug: session.session.slug ?? null,
      },
    })
    records.push(sessionRecord)

    const normalizedPath = join(
      outDir,
      buildOpencodeArtifactFilename(
        'normalized',
        session.session.time?.created,
        session.session.id,
      ),
    )
    writeFileSync(
      normalizedPath,
      buildNormalizedSessionDoc(
        session,
        extraction.project.id,
        normalizedMessages,
      ),
      'utf-8',
    )
    normalizedPaths.push(normalizedPath)

    if (shouldSummarize && summaryConfig) {
      const summary = dependencies.summarizeSession
        ? await dependencies.summarizeSession(
            session,
            normalizedMessages,
            summaryConfig,
          )
        : await summarizeOpencodeSession(
            session,
            extraction.project.id,
            normalizedMessages,
            summaryConfig,
            dependencies.llmClientFactory,
          )
      const normalizedSummary = normalizeSummary(
        summary,
        sessionRecord.references.filePaths,
      )
      const summaryPath = join(
        outDir,
        buildOpencodeArtifactFilename(
          'summary',
          session.session.time?.created,
          session.session.id,
        ),
      )
      const summaryDoc = buildSummaryDoc(
        session,
        extraction.project.id,
        normalizedSummary,
        summaryConfig,
      )
      writeFileSync(summaryPath, summaryDoc, 'utf-8')
      summaryPaths.push(summaryPath)

      const summaryMetaPath = join(
        outDir,
        buildOpencodeArtifactFilename(
          'summaryMeta',
          session.session.time?.created,
          session.session.id,
        ),
      )
      writeFileSync(
        summaryMetaPath,
        `${JSON.stringify(
          buildSummaryMeta(
            session,
            extraction.project.id,
            normalizedSummary,
            summaryConfig,
          ),
          null,
          2,
        )}\n`,
        'utf-8',
      )
      summaryMetaPaths.push(summaryMetaPath)

      records.push(
        normalizeOpencodeSummaryRecord(
          buildOpencodeRecallSummary(
            session,
            extraction.project.id,
            normalizedSummary,
          ),
        ),
      )
    }
  }

  const checkpoint = dependencies.stateRepository
    ? dependencies.stateRepository.putCheckpoint(
        createCheckpointInput({
          source: 'opencode',
          scope: `project:${extraction.project.id}`,
          cursor: extraction.sessions[0]?.session.id ?? null,
          fingerprint: buildCheckpointFingerprint(records),
          recordCount: records.length,
          metadata: {
            repoPath: extraction.repoPath,
            outDir,
            summarizedSessions: summaryPaths.length,
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
    summarizedSessions: summaryPaths.length,
    records,
    checkpoint,
    artifacts: {
      normalized: normalizedPaths,
      summaries: summaryPaths,
      summaryMeta: summaryMetaPaths,
    },
  }
}

function resolveSummaryConfig(
  options: OpencodeCollectionOptions,
): ResolvedSummaryConfig | null {
  if (options.summarize === false) {
    return null
  }
  const memoryConfig = getMemoryConfig().consolidation
  const apiKey =
    options.summaryApiKey ??
    process.env.OPENCODE_ZEN_API_KEY ??
    process.env.SUMMARY_API_KEY ??
    process.env.OPENAI_API_KEY ??
    memoryConfig?.api_key ??
    null
  const model =
    options.summaryModel ??
    process.env.SUMMARY_MODEL ??
    memoryConfig?.model ??
    null

  if (!apiKey || !model) {
    if (hasExplicitSummaryOverrides(options)) {
      throw new Error(
        'Incomplete OpenCode summary configuration. Provide both a summary API key and model.',
      )
    }
    return null
  }

  return {
    apiUrl:
      options.summaryApiUrl ??
      process.env.SUMMARY_API_URL ??
      memoryConfig?.api_url ??
      DEFAULT_SUMMARY_API_URL,
    apiKey,
    model,
    maxTokens:
      normalizePositiveInteger(options.summaryMaxTokens) ??
      memoryConfig?.max_tokens ??
      DEFAULT_SUMMARY_MAX_TOKENS,
    timeoutMs:
      normalizePositiveInteger(options.summaryTimeoutMs) ??
      memoryConfig?.timeout_ms ??
      DEFAULT_SUMMARY_TIMEOUT_MS,
    maxChars:
      normalizePositiveInteger(options.summaryMaxChars) ??
      DEFAULT_SUMMARY_MAX_CHARS,
    maxLines:
      normalizePositiveInteger(options.summaryMaxLines) ??
      DEFAULT_SUMMARY_MAX_LINES,
    mergeMaxEstTokens:
      normalizePositiveInteger(options.summaryMergeMaxEstTokens) ??
      DEFAULT_SUMMARY_MERGE_MAX_EST_TOKENS,
  }
}

function hasExplicitSummaryOverrides(
  options: OpencodeCollectionOptions,
): boolean {
  return [
    options.summaryModel,
    options.summaryApiKey,
    options.summaryApiUrl,
    options.summaryMaxTokens,
    options.summaryTimeoutMs,
    options.summaryMaxChars,
    options.summaryMaxLines,
    options.summaryMergeMaxEstTokens,
  ].some((value) => value !== undefined && value !== null)
}

function normalizeSessionMessages(
  messageBlocks: OpencodeMessageBlock[],
): NormalizedOpencodeMessage[] {
  return messageBlocks
    .map(({ message, parts }) => {
      const text = normalizeWhitespace(
        parts
          .filter(
            (part) => part.type === 'text' && typeof part.text === 'string',
          )
          .map((part) => part.text as string)
          .join('\n'),
      )
      const fallback = normalizeWhitespace(message.summary?.title ?? '')
      const finalText = text || fallback
      if (!finalText) {
        return null
      }
      return {
        id: message.id,
        role: message.role ?? 'unknown',
        createdAt: toIso(message.time?.created),
        text: finalText,
      }
    })
    .filter((message): message is NormalizedOpencodeMessage => message !== null)
}

function buildNormalizedTranscript(
  messages: NormalizedOpencodeMessage[],
): string {
  return messages.map(renderNormalizedMessageBlock).join('\n\n')
}

function renderNormalizedMessageBlock(
  message: NormalizedOpencodeMessage,
): string {
  const roleLabel =
    message.role === 'assistant'
      ? 'Agent'
      : message.role === 'user'
        ? 'User'
        : capitalize(message.role)
  const timeLabel = message.createdAt ? ` (${message.createdAt})` : ''
  return `### ${roleLabel}${timeLabel}\n\n${message.text}`
}

async function summarizeOpencodeSession(
  session: OpencodeSessionBundle,
  projectId: string,
  messages: NormalizedOpencodeMessage[],
  config: ResolvedSummaryConfig,
  llmClientFactory: typeof createLlmClient = createLlmClient,
): Promise<RecallSummaryResult> {
  const client = llmClientFactory({
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    model: config.model,
    maxTokens: config.maxTokens,
    timeoutMs: config.timeoutMs,
  })
  const blocks = messages.map(renderNormalizedMessageBlock)
  const chunks = planRecallSummaryChunks(blocks, {
    maxChars: config.maxChars,
    maxLines: config.maxLines,
  })
  if (chunks.length === 0) {
    return emptySummary(
      session.session.title ?? session.session.slug ?? session.session.id,
    )
  }

  const chunkSummaries = await Promise.all(
    chunks.map(async (chunk) => {
      const response = await client.callWithRetry({
        messages: [
          { role: 'system', content: SUMMARY_CHUNK_PROMPT },
          { role: 'user', content: `Transcript chunk:\n\n${chunk.content}` },
        ],
      })
      return parseRecallSummaryJson(response.content)
    }),
  )

  if (chunkSummaries.length === 1) {
    return chunkSummaries[0]
  }

  const merged = await mergeRecallSummaryItems(
    chunkSummaries.map((summary) => buildRecallSummaryItem(summary)),
    { maxTokens: config.mergeMaxEstTokens },
    async (summaries) => mergeSummaryChunkResults(client, summaries),
  )
  return merged.summary
}

async function mergeSummaryChunkResults(
  client: LlmClient,
  summaries: RecallSummaryResult[],
): Promise<RecallSummaryResult> {
  const response = await client.callWithRetry({
    messages: [
      { role: 'system', content: SUMMARY_MERGE_PROMPT },
      {
        role: 'user',
        content: `Chunk summaries (JSON array):\n\n${JSON.stringify(summaries, null, 2)}`,
      },
    ],
  })
  return parseRecallSummaryJson(response.content)
}

function buildNormalizedSessionDoc(
  session: OpencodeSessionBundle,
  projectId: string,
  messages: NormalizedOpencodeMessage[],
): string {
  const frontmatter = serializeFrontmatter({
    source: 'opencode',
    session_id: session.session.id,
    project_id: projectId,
    directory: session.session.directory ?? null,
    slug: session.session.slug ?? null,
    title: session.session.title ?? null,
    created_at: toIso(session.session.time?.created),
    updated_at: toIso(session.session.time?.updated),
    message_count: messages.length,
    normalized: true,
  })
  const title =
    session.session.title?.trim() || session.session.slug || session.session.id
  return [
    frontmatter,
    '',
    `# Session: ${title}`,
    '',
    '## Transcript',
    '',
    ...messages.map((message) => renderNormalizedMessageBlock(message)),
    '',
  ].join('\n')
}

function buildSummaryDoc(
  session: OpencodeSessionBundle,
  projectId: string,
  summary: RecallSummaryResult,
  config: ResolvedSummaryConfig,
): string {
  const keywordTotal = 0
  const frontmatter = serializeFrontmatter({
    source: 'opencode',
    session_id: session.session.id,
    project_id: projectId,
    directory: session.session.directory ?? null,
    slug: session.session.slug ?? null,
    title: session.session.title ?? null,
    created_at: toIso(session.session.time?.created),
    updated_at: toIso(session.session.time?.updated),
    summary_model: config.model,
    summary_chunks: 1,
    summary_max_chars: config.maxChars,
    summary_max_lines: config.maxLines,
    summary_generated_at: new Date().toISOString(),
    summary_keyword_total: keywordTotal,
  })
  const title =
    session.session.title?.trim() || session.session.slug || session.session.id
  return [
    frontmatter,
    '',
    `# Session Summary: ${title}`,
    '',
    '## Focus',
    '',
    summary.focus || 'none',
    '',
    '## Decisions',
    '',
    ...renderSummaryList(summary.decisions),
    '',
    '## Discoveries',
    '',
    ...renderSummaryList(summary.discoveries),
    '',
    '## Patterns',
    '',
    ...renderSummaryList(summary.patterns),
    '',
    '## Tasks',
    '',
    ...renderSummaryList(summary.tasks),
    '',
    '## Files',
    '',
    ...renderSummaryList(summary.files),
    '',
    '## Keywords',
    '',
    '- none',
    '',
    '## Blockers',
    '',
    ...renderSummaryList(summary.blockers),
    '',
    '## Open Questions',
    '',
    ...renderSummaryList(summary.open_questions),
    '',
    '## Next Steps',
    '',
    ...renderSummaryList(summary.next_steps),
    '',
    `## Confidence (${summary.confidence})`,
    '',
    '',
  ].join('\n')
}

function buildSummaryMeta(
  session: OpencodeSessionBundle,
  projectId: string,
  summary: RecallSummaryResult,
  config: ResolvedSummaryConfig,
): Record<string, unknown> {
  return {
    session_id: session.session.id,
    project_id: projectId,
    directory: session.session.directory ?? null,
    title: session.session.title ?? null,
    summary_model: config.model,
    summary_generated_at: new Date().toISOString(),
    summary_chunks: 1,
    summary_max_chars: config.maxChars,
    summary_max_lines: config.maxLines,
    summary_keyword_total: 0,
    confidence: summary.confidence,
  }
}

function buildOpencodeRecallSummary(
  session: OpencodeSessionBundle,
  projectId: string,
  summary: RecallSummaryResult,
): OpencodeRecallSummary {
  return {
    sessionId: session.session.id,
    projectId,
    createdAt: toIso(session.session.time?.created) ?? new Date().toISOString(),
    updatedAt:
      toIso(session.session.time?.updated) ??
      toIso(session.session.time?.created) ??
      new Date().toISOString(),
    directory: session.session.directory ?? null,
    title: session.session.title ?? session.session.slug ?? null,
    focus: summary.focus,
    decisions: summary.decisions,
    discoveries: summary.discoveries,
    patterns: summary.patterns,
    blockers: summary.blockers,
    openQuestions: summary.open_questions,
    nextSteps: summary.next_steps,
    tasks: summary.tasks,
    files: summary.files,
    confidence: summary.confidence === 'med' ? 'medium' : summary.confidence,
  }
}

function normalizeSummary(
  summary: RecallSummaryResult,
  allowedFiles: string[],
): RecallSummaryResult {
  const allowed = new Set(allowedFiles)
  return {
    focus: normalizeWhitespace(summary.focus),
    decisions: dedupeStrings(summary.decisions),
    discoveries: dedupeStrings(summary.discoveries),
    patterns: dedupeStrings(summary.patterns),
    tasks: dedupeStrings(summary.tasks),
    files: dedupeStrings(summary.files).filter((file) => allowed.has(file)),
    blockers: dedupeStrings(summary.blockers),
    open_questions: dedupeStrings(summary.open_questions),
    next_steps: dedupeStrings(summary.next_steps),
    confidence: normalizeConfidence(summary.confidence),
  }
}

function buildCheckpointFingerprint(records: CollectedRecord[]): string {
  return createHash('sha256')
    .update(records.map((record) => record.fingerprint).join('|'))
    .digest('hex')
}

function renderSummaryList(items: string[]): string[] {
  if (items.length === 0) {
    return ['- none']
  }
  return items.map((item) => `- ${item}`)
}

function dedupeStrings(items: string[]): string[] {
  const output: string[] = []
  for (const item of items) {
    const normalized = normalizeWhitespace(item)
    if (!normalized || output.includes(normalized)) {
      continue
    }
    output.push(normalized)
  }
  return output
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function capitalize(value: string): string {
  if (!value) {
    return 'Unknown'
  }
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}

function toIso(value?: number | null): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  return new Date(value).toISOString()
}

function normalizePositiveInteger(
  value: number | null | undefined,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  const rounded = Math.round(value)
  return rounded > 0 ? rounded : null
}

function emptySummary(focus: string): RecallSummaryResult {
  return {
    focus,
    decisions: [],
    discoveries: [],
    patterns: [],
    tasks: [],
    files: [],
    blockers: [],
    open_questions: [],
    next_steps: [],
    confidence: 'low',
  }
}

function normalizeConfidence(
  value: RecallSummaryConfidence,
): RecallSummaryConfidence {
  if (value === 'low' || value === 'med' || value === 'high') {
    return value
  }
  return 'low'
}
