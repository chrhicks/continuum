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
  parseRecallSummaryJson,
  RECALL_SUMMARY_JSON_SCHEMA,
  type RecallSummaryResult,
} from '../opencode/summary-schema'
import type { ResolvedSummaryConfig } from './opencode-artifacts'
import {
  renderNormalizedMessageBlock,
  type NormalizedOpencodeMessage,
} from './opencode-artifacts'

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

  const chunkSummaries = await Promise.all(
    chunks.map(async (chunk) => summarizeChunk(client, chunk.content)),
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

async function summarizeChunk(
  client: LlmClient,
  content: string,
): Promise<RecallSummaryResult> {
  const response = await client.callWithRetry({
    messages: [
      { role: 'system', content: SUMMARY_CHUNK_PROMPT },
      { role: 'user', content: `Transcript chunk:\n\n${content}` },
    ],
  })
  return parseRecallSummaryJson(response.content)
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
