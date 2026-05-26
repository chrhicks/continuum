import { createLlmClient } from '../llm/client'
import type { ConsolidationLlmConfig } from './config'
import type { MemorySummary } from './types'

/**
 * Structured summary produced either by an LLM or the mechanical fallback.
 * consolidate.ts consumes this shape regardless of which path produced it.
 */
export type NowSummary = MemorySummary

// ---------------------------------------------------------------------------
// LLM path
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You summarize the work recorded in a Continuum NOW file.

A NOW file is an append log written by an AI coding agent during a session.
Entries are structured task-loop records with fields like:
  Goal alignment: ...
  Task: ...
  Step: ...
  Changes: ...
  Tests: ...
  Outcome: ...

Rules:
- Use only facts present in the NOW content. Do not invent.
- narrative must be prose paragraphs, not a list.
- Each array item is a complete sentence or phrase, not a fragment.
- Prefer specific over vague: "used session IDs in MEMORY frontmatter for dedup
  because file hashes break on regeneration" beats "improved deduplication".
- If the session content is sparse or unclear, write a short honest narrative
  and return empty arrays for most fields.`

const NOW_SUMMARY_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: [
    'narrative',
    'decisions',
    'discoveries',
    'patterns',
    'whatWorked',
    'whatFailed',
    'blockers',
    'openQuestions',
    'nextSteps',
    'tasks',
    'files',
    'confidence',
  ],
  properties: {
    narrative: { type: 'string' },
    decisions: { type: 'array', items: { type: 'string' } },
    discoveries: { type: 'array', items: { type: 'string' } },
    patterns: { type: 'array', items: { type: 'string' } },
    whatWorked: { type: 'array', items: { type: 'string' } },
    whatFailed: { type: 'array', items: { type: 'string' } },
    blockers: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } },
    nextSteps: { type: 'array', items: { type: 'string' } },
    tasks: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
    confidence: {
      anyOf: [
        { type: 'string', enum: ['low', 'medium', 'high'] },
        { type: 'null' },
      ],
    },
  },
} as const

const NOW_SUMMARY_SCHEMA_NAME = 'now_summary'

export async function summarizeNow(
  body: string,
  llmConfig: ConsolidationLlmConfig,
): Promise<NowSummary> {
  const client = createLlmClient({
    apiUrl: llmConfig.api_url,
    apiKey: llmConfig.api_key,
    model: llmConfig.model,
    maxTokens: llmConfig.max_tokens,
    timeoutMs: llmConfig.timeout_ms,
  })

  const response = await client.callWithRetry({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `NOW file content:\n\n${body}` },
    ],
    structuredOutput: {
      jsonSchema: {
        name: NOW_SUMMARY_SCHEMA_NAME,
        schema: NOW_SUMMARY_JSON_SCHEMA,
      },
      validate: validateNowSummary,
    },
  })

  if (!response.structuredOutput) {
    throw new Error('LLM structured output missing NOW summary payload.')
  }

  return response.structuredOutput
}

function validateNowSummary(raw: unknown): NowSummary {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Summary response is not an object.')
  }
  const r = raw as Record<string, unknown>
  return {
    narrative: requireString(r, 'narrative'),
    decisions: requireStringArray(r, 'decisions'),
    discoveries: requireStringArray(r, 'discoveries'),
    patterns: requireOptionalStringArray(r, 'patterns'),
    whatWorked: requireStringArray(r, 'whatWorked'),
    whatFailed: requireStringArray(r, 'whatFailed'),
    blockers: requireOptionalStringArray(r, 'blockers'),
    openQuestions: requireStringArray(r, 'openQuestions'),
    nextSteps: requireStringArray(r, 'nextSteps'),
    tasks: requireStringArray(r, 'tasks'),
    files: requireStringArray(r, 'files'),
    confidence: requireOptionalConfidence(r, 'confidence'),
  }
}

function requireString(rec: Record<string, unknown>, key: string): string {
  if (typeof rec[key] !== 'string') {
    throw new Error(`Summary field "${key}" must be a string.`)
  }
  return (rec[key] as string).trim()
}

function requireStringArray(
  rec: Record<string, unknown>,
  key: string,
): string[] {
  if (!Array.isArray(rec[key])) {
    throw new Error(`Summary field "${key}" must be an array.`)
  }
  return (rec[key] as unknown[]).map((item, i) => {
    if (typeof item !== 'string') {
      throw new Error(`Summary field "${key}[${i}]" must be a string.`)
    }
    return item.trim()
  })
}

function requireOptionalStringArray(
  rec: Record<string, unknown>,
  key: string,
): string[] {
  if (rec[key] === undefined) {
    return []
  }
  return requireStringArray(rec, key)
}

function requireOptionalConfidence(
  rec: Record<string, unknown>,
  key: string,
): MemorySummary['confidence'] {
  const value = rec[key]
  if (value === undefined || value === null) {
    return null
  }
  if (value === 'low' || value === 'medium' || value === 'high') {
    return value
  }
  throw new Error(`Summary field "${key}" must be low, medium, or high.`)
}

// ---------------------------------------------------------------------------
// Mechanical fallback
// ---------------------------------------------------------------------------

const FILE_PATTERN =
  /\b[\w./-]+\.(ts|tsx|js|jsx|json|md|yaml|yml|sql|sh|go|py|rs)\b/gi

export function mechanicalSummary(body: string): NowSummary {
  return {
    narrative: extractNarrative(body),
    decisions: extractMarkers(body, /@decision\b[:\s-]*(.+)/i),
    discoveries: extractMarkers(body, /@discovery\b[:\s-]*(.+)/i),
    patterns: extractMarkers(body, /@pattern\b[:\s-]*(.+)/i),
    whatWorked: [],
    whatFailed: [],
    blockers: [],
    openQuestions: [],
    nextSteps: [],
    tasks: extractTasks(body),
    files: extractFiles(body),
    confidence: null,
  }
}

function extractNarrative(body: string): string {
  // Prefer Goal alignment lines, then first ## User: line
  const goalMatch = body.match(/^\s*[-*]?\s*Goal alignment\s*:\s*(.+)$/im)
  if (goalMatch?.[1]) {
    return goalMatch[1].trim()
  }
  const userMatch = body.match(/^## User:\s*(.+)$/m)
  if (userMatch?.[1]) {
    return userMatch[1].trim()
  }
  return 'No summary available.'
}

function extractMarkers(body: string, pattern: RegExp): string[] {
  const results: string[] = []
  for (const line of body.split('\n')) {
    const match = line.match(pattern)
    if (match?.[1]) {
      results.push(match[1].trim())
    }
  }
  return unique(results)
}

function extractTasks(body: string): string[] {
  return unique(body.match(/\btkt[-_][a-zA-Z0-9_-]+\b/g) ?? [])
}

function extractFiles(body: string): string[] {
  // Prefer explicit Changes: lines
  const changes: string[] = []
  for (const line of body.split('\n')) {
    const match = line.match(/^\s*[-*]?\s*Changes:\s*(.+)$/i)
    if (!match?.[1]) continue
    const val = match[1].trim().toLowerCase()
    if (val === 'none' || val === 'n/a') continue
    const found = match[1].match(FILE_PATTERN)
    if (found) changes.push(...found)
  }
  if (changes.length > 0) return unique(changes)
  return unique(body.match(FILE_PATTERN) ?? [])
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items))
}
