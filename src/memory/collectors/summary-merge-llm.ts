import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { LlmClient } from '../../llm/client'
import {
  RECALL_SUMMARY_JSON_SCHEMA,
  RECALL_SUMMARY_SCHEMA_NAME,
  type RecallSummaryResult,
  validateRecallSummaryInput,
} from '../opencode/summary-schema'
import {
  delayBeforeRetry,
  isRetryableSummaryFormatError,
} from './summary-chunk-llm'

const SUMMARY_MERGE_PROMPT = `You merge multiple chunk summaries into one session summary.

Use only facts present in the provided chunk summaries. Do not add new facts.

Merge rules:
- De-duplicate list items; keep the most specific version.
- If items conflict, prefer the most recent or surface the uncertainty in open_questions.
- Do not reclassify proposals or suggestions as decisions.
- Keep only durable, high-signal items worth remembering later.
- All fields must be populated, even when most arrays are empty.`

export async function mergeSummaryChunkResults(
  client: LlmClient,
  summaries: RecallSummaryResult[],
  cacheDir?: string,
): Promise<RecallSummaryResult> {
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

  const maxParseRetries = 3
  let lastError: Error | undefined

  for (let attempt = 1; attempt <= maxParseRetries; attempt++) {
    try {
      writeMergeDebugArtifact(cacheDir, summaries, attempt, {
        phase: 'request',
        summaries,
      })
      const parsed = await requestMergedSummary(
        client,
        summaries,
        cacheDir,
        attempt,
      )
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
        await delayBeforeRetry(attempt, 'Merge')
      }
    }
  }

  throw (
    lastError ?? new Error('Failed to merge chunk summaries into valid JSON.')
  )
}

async function requestMergedSummary(
  client: LlmClient,
  summaries: RecallSummaryResult[],
  cacheDir: string | undefined,
  attempt: number,
): Promise<RecallSummaryResult> {
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
  return parsed
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
