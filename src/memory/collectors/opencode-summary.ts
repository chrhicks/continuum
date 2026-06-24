import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLlmClient } from '../../llm/client'
import type { LlmClient } from '../../llm/client'
import type {
  OpencodeMessageBlock,
  OpencodeSessionBundle,
} from '../opencode/extract'
import {
  mergeRecallSummaryItems,
  buildRecallSummaryItem,
} from '../opencode/summary-merge'
import { planRecallSummaryChunks } from '../opencode/summary-chunks'
import {
  RECALL_SUMMARY_JSON_SCHEMA,
  RECALL_SUMMARY_SCHEMA_NAME,
  type RecallSummaryResult,
  validateRecallSummaryInput,
} from '../opencode/summary-schema'
import type { ResolvedSummaryConfig } from './opencode-artifacts'
import {
  renderNormalizedMessageBlock,
  type NormalizedOpencodeMessage,
} from './opencode-artifacts'

const SUMMARY_CHUNK_PROMPT = `You are summarizing a chunk of an OpenCode session transcript.

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

If a field is unknown or empty, use an empty string (focus only) or empty array. All fields must be populated.`

const SUMMARY_MERGE_PROMPT = `You merge multiple chunk summaries into one session summary.

Use only facts present in the provided chunk summaries. Do not add new facts.

Merge rules:
- De-duplicate list items; keep the most specific version.
- If items conflict, prefer the most recent or surface the uncertainty in open_questions.
- Do not reclassify proposals or suggestions as decisions.
- Keep only durable, high-signal items worth remembering later.
- All fields must be populated, even when most arrays are empty.`

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

  const chunkSummaries: RecallSummaryResult[] = []
  for (const chunk of chunks) {
    console.error(
      `[summarize] Chunk ${chunk.index}/${chunk.total} (${chunk.blockCount} blocks, ${chunk.lineCount} lines, ${chunk.charCount} chars)...`,
    )
    const start = Date.now()

    const cachePath = cacheDir
      ? getChunkCachePath(cacheDir, chunk.content)
      : null
    let summary: RecallSummaryResult | null = null

    if (cachePath && existsSync(cachePath)) {
      try {
        const cached = JSON.parse(readFileSync(cachePath, 'utf-8')) as unknown
        summary = validateRecallSummaryInput(cached)
        console.error(
          `[summarize] Chunk ${chunk.index}/${chunk.total} loaded from cache`,
        )
      } catch {
        summary = null
      }
    }

    if (!summary) {
      summary = await summarizeChunk(client, chunk.content, cacheDir)
      if (cachePath) {
        writeFileSync(
          cachePath,
          JSON.stringify(summary, null, 2) + '\n',
          'utf-8',
        )
      }
    }

    chunkSummaries.push(summary)
    console.error(
      `[summarize] Chunk ${chunk.index}/${chunk.total} done in ${Date.now() - start}ms`,
    )
  }
  if (chunkSummaries.length === 1) {
    return chunkSummaries[0]
  }

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

async function summarizeChunk(
  client: LlmClient,
  content: string,
  cacheDir?: string,
): Promise<RecallSummaryResult> {
  const maxParseRetries = 3
  let lastError: Error | undefined

  for (let attempt = 1; attempt <= maxParseRetries; attempt++) {
    try {
      const response = await client.callWithRetry({
        messages: [
          { role: 'system', content: SUMMARY_CHUNK_PROMPT },
          { role: 'user', content: `Transcript chunk:\n\n${content}` },
        ],
        structuredOutput: {
          jsonSchema: {
            name: RECALL_SUMMARY_SCHEMA_NAME,
            schema: RECALL_SUMMARY_JSON_SCHEMA,
          },
          validate: validateRecallSummaryInput,
        },
      })
      if (cacheDir) {
        const cachePath = join(
          cacheDir,
          `chunk-attempt-${attempt}-${Date.now()}.json`,
        )
        writeFileSync(
          cachePath,
          JSON.stringify(
            {
              raw: response.content,
              finishReason: response.finishReason,
              structuredOutput: response.structuredOutput,
            },
            null,
            2,
          ),
          'utf-8',
        )
      }
      if (!response.structuredOutput) {
        throw new Error('LLM structured output missing recall summary payload.')
      }
      return response.structuredOutput
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (!isRetryableSummaryFormatError(lastError)) {
        throw lastError
      }
      if (attempt < maxParseRetries) {
        const delay = Math.pow(3, attempt - 1) * 1000
        console.error(
          `[summarize] Chunk JSON parse failed, retrying in ${delay}ms... (${attempt}/${maxParseRetries}): ${lastError.message}`,
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError ?? new Error('Failed to summarize chunk into valid JSON.')
}

async function mergeSummaryChunkResults(
  client: LlmClient,
  summaries: RecallSummaryResult[],
  cacheDir?: string,
): Promise<RecallSummaryResult> {
  const maxParseRetries = 3
  let lastError: Error | undefined
  const mergeCachePath = cacheDir
    ? getMergeCachePath(cacheDir, summaries)
    : null

  if (mergeCachePath && existsSync(mergeCachePath)) {
    try {
      const cached = JSON.parse(
        readFileSync(mergeCachePath, 'utf-8'),
      ) as unknown
      return validateRecallSummaryInput(cached)
    } catch {
      // Ignore stale or corrupted cache and recompute.
    }
  }

  for (let attempt = 1; attempt <= maxParseRetries; attempt++) {
    try {
      writeMergeDebugArtifact(cacheDir, summaries, attempt, {
        phase: 'request',
        summaries,
      })
      const response = await client.callWithRetry(
        {
          messages: [
            { role: 'system', content: SUMMARY_MERGE_PROMPT },
            {
              role: 'user',
              content: `Chunk summaries (JSON array):\n\n${JSON.stringify(summaries, null, 2)}`,
            },
          ],
          structuredOutput: {
            jsonSchema: {
              name: RECALL_SUMMARY_SCHEMA_NAME,
              schema: RECALL_SUMMARY_JSON_SCHEMA,
            },
            validate: validateRecallSummaryInput,
          },
        },
        {
          // Merge passes can accumulate a lot of list items before they collapse.
          // Give structured output more headroom than the default call cap.
          maxTokensCap: Math.max(client.config.maxTokens * 6, 24000),
        },
      )
      writeMergeDebugArtifact(cacheDir, summaries, attempt, {
        phase: 'response',
        finishReason: response.finishReason,
        raw: response.content,
        structuredOutput: response.structuredOutput,
      })
      const parsed = response.structuredOutput
      if (!parsed) {
        if (response.finishReason === 'length') {
          throw new Error(
            'LLM structured output was truncated at the merge token cap.',
          )
        }
        throw new Error('LLM structured output missing recall summary payload.')
      }
      if (mergeCachePath) {
        writeFileSync(
          mergeCachePath,
          JSON.stringify(parsed, null, 2) + '\n',
          'utf-8',
        )
      }
      return parsed
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      writeMergeDebugArtifact(cacheDir, summaries, attempt, {
        phase: 'error',
        error: lastError.message,
      })
      if (!isRetryableSummaryFormatError(lastError)) {
        throw lastError
      }
      if (attempt < maxParseRetries) {
        const delay = Math.pow(3, attempt - 1) * 1000
        console.error(
          `[summarize] Merge JSON parse failed, retrying in ${delay}ms... (${attempt}/${maxParseRetries}): ${lastError.message}`,
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  throw (
    lastError ?? new Error('Failed to merge chunk summaries into valid JSON.')
  )
}

function getMergeCachePath(
  cacheDir: string,
  summaries: RecallSummaryResult[],
): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(summaries))
    .digest('hex')
    .slice(0, 16)
  return join(cacheDir, `merge-${hash}.json`)
}

function isRetryableSummaryFormatError(error: Error): boolean {
  return (
    error.message.startsWith('Failed to parse structured LLM response') ||
    error.message.startsWith('Summary response is not valid JSON') ||
    error.message.startsWith('Invalid recall summary JSON.')
  )
}

function writeMergeDebugArtifact(
  cacheDir: string | undefined,
  summaries: RecallSummaryResult[],
  attempt: number,
  payload: Record<string, unknown>,
): void {
  if (!cacheDir) {
    return
  }
  const hash = createHash('sha256')
    .update(JSON.stringify(summaries))
    .digest('hex')
    .slice(0, 16)
  const phase = typeof payload.phase === 'string' ? payload.phase : 'event'
  const path = join(
    cacheDir,
    `merge-debug-${hash}-${phase}-attempt-${attempt}.json`,
  )
  writeFileSync(path, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
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
