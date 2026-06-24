import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LlmClient } from '../../llm/client'
import {
  RECALL_SUMMARY_JSON_SCHEMA,
  RECALL_SUMMARY_SCHEMA_NAME,
  type RecallSummaryResult,
  validateRecallSummaryInput,
} from '../opencode/summary-schema'

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

export async function summarizeChunk(
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
        writeFileSync(
          join(cacheDir, `chunk-attempt-${attempt}-${Date.now()}.json`),
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
        await delayBeforeRetry(attempt, 'Chunk')
      }
    }
  }

  throw lastError ?? new Error('Failed to summarize chunk into valid JSON.')
}

export async function delayBeforeRetry(
  attempt: number,
  label: string,
): Promise<void> {
  const delay = Math.pow(3, attempt - 1) * 1000
  console.error(
    `[summarize] ${label} JSON parse failed, retrying in ${delay}ms... (${attempt}/3)`,
  )
  await new Promise((resolve) => setTimeout(resolve, delay))
}

export function isRetryableSummaryFormatError(error: Error): boolean {
  return (
    error.message.startsWith('Failed to parse structured LLM response') ||
    error.message.startsWith('Summary response is not valid JSON') ||
    error.message.startsWith('Invalid recall summary JSON.')
  )
}
