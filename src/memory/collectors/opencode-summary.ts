import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { createLlmClient } from '../../llm/client'
import type {
  OpencodeSessionBundle,
} from '../opencode/extract'
import {
  mergeRecallSummaryItems,
  buildRecallSummaryItem,
} from '../opencode/summary-merge'
import { planRecallSummaryChunks } from '../opencode/summary-chunks'
import type { RecallSummaryResult } from '../opencode/summary-schema'
import { validateRecallSummaryInput } from '../opencode/summary-schema'
import type { ResolvedSummaryConfig } from './opencode-artifacts'
import {
  renderNormalizedMessageBlock,
  type NormalizedOpencodeMessage,
} from './opencode-artifacts'
import { summarizeChunk } from './summary-chunk-llm'
import { mergeSummaryChunkResults } from './summary-merge-llm'

export function countSummaryChunks(
  messages: NormalizedOpencodeMessage[],
  config: ResolvedSummaryConfig,
): number {
  return planRecallSummaryChunks(
    messages.map((message) => renderNormalizedMessageBlock(message)),
    {
      maxChars: config.maxChars,
      maxLines: config.maxLines,
    },
  ).length
}

export async function summarizeOpencodeSession(
  session: OpencodeSessionBundle,
  messages: NormalizedOpencodeMessage[],
  config: ResolvedSummaryConfig,
  llmClientFactory: typeof createLlmClient = createLlmClient,
  cacheDir?: string,
): Promise<RecallSummaryResult> {
  const client = llmClientFactory({
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    model: config.model,
    maxTokens: config.maxTokens,
    timeoutMs: config.timeoutMs,
  })
  const chunks = planRecallSummaryChunks(
    messages.map(renderNormalizedMessageBlock),
    {
      maxChars: config.maxChars,
      maxLines: config.maxLines,
    },
  )
  if (chunks.length === 0) {
    return emptySummary(
      session.session.title ?? session.session.slug ?? session.session.id,
    )
  }

  if (cacheDir) {
    mkdirSync(cacheDir, { recursive: true })
  }

  const chunkSummaries = await collectChunkSummaries(client, chunks, cacheDir)
  if (chunkSummaries.length === 1) {
    return chunkSummaries[0]
  }

  return mergeChunkSummaries(client, chunkSummaries, config, cacheDir)
}

async function collectChunkSummaries(
  client: ReturnType<typeof createLlmClient>,
  chunks: Array<{ index: number; total: number; blockCount: number; lineCount: number; charCount: number; content: string }>,
  cacheDir: string | undefined,
): Promise<RecallSummaryResult[]> {
  const summaries: RecallSummaryResult[] = []
  for (const chunk of chunks) {
    console.error(
      `[summarize] Chunk ${chunk.index}/${chunk.total} (${chunk.blockCount} blocks, ${chunk.lineCount} lines, ${chunk.charCount} chars)...`,
    )
    const start = Date.now()
    const summary = await loadOrSummarizeChunk(client, chunk, cacheDir)
    summaries.push(summary)
    console.error(
      `[summarize] Chunk ${chunk.index}/${chunk.total} done in ${Date.now() - start}ms`,
    )
  }
  return summaries
}

async function loadOrSummarizeChunk(
  client: ReturnType<typeof createLlmClient>,
  chunk: { index: number; total: number; content: string },
  cacheDir: string | undefined,
): Promise<RecallSummaryResult> {
  const cachePath = cacheDir
    ? getChunkCachePath(cacheDir, chunk.content)
    : null

  if (cachePath && existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, 'utf-8')) as unknown
      console.error(
        `[summarize] Chunk ${chunk.index}/${chunk.total} loaded from cache`,
      )
      return validateRecallSummaryInput(cached)
    } catch {
      // Ignore stale or corrupted cache and recompute.
    }
  }

  const summary = await summarizeChunk(client, chunk.content, cacheDir)
  if (cachePath) {
    writeFileSync(cachePath, JSON.stringify(summary, null, 2) + '\n', 'utf-8')
  }
  return summary
}

async function mergeChunkSummaries(
  client: ReturnType<typeof createLlmClient>,
  chunkSummaries: RecallSummaryResult[],
  config: ResolvedSummaryConfig,
  cacheDir: string | undefined,
): Promise<RecallSummaryResult> {
  console.error(
    `[summarize] Merging ${chunkSummaries.length} chunk summaries...`,
  )
  const mergeStart = Date.now()
  const merged = await mergeRecallSummaryItems(
    chunkSummaries.map((summary) => buildRecallSummaryItem(summary)),
    { maxTokens: config.mergeMaxEstTokens },
    async (summaries, context) => {
      console.error(
        `[summarize] Merge pass ${context.pass}, group ${context.groupIndex}/${context.groupCount} (${context.mode})...`,
      )
      const result = await mergeSummaryChunkResults(client, summaries, cacheDir)
      console.error(
        `[summarize] Merge pass ${context.pass}, group ${context.groupIndex} done`,
      )
      return result
    },
  )
  console.error(`[summarize] Merge complete in ${Date.now() - mergeStart}ms`)
  return merged.summary
}

function getChunkCachePath(cacheDir: string, content: string): string {
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16)
  return join(cacheDir, `chunk-${hash}.json`)
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
