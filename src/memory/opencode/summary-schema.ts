import { z } from 'zod'

export const RECALL_SUMMARY_FIELDS = [
  'focus',
  'decisions',
  'discoveries',
  'patterns',
  'tasks',
  'files',
  'blockers',
  'open_questions',
  'next_steps',
  'confidence',
  'keywords',
] as const

export const RECALL_SUMMARY_CONFIDENCE_VALUES = ['low', 'med', 'high'] as const

export const RECALL_SUMMARY_SCHEMA_NAME = 'recall_summary'

export type RecallSummaryConfidence =
  (typeof RECALL_SUMMARY_CONFIDENCE_VALUES)[number]

export type RecallSummaryKeywordGroup =
  | 'commands'
  | 'flags'
  | 'errors'
  | 'constants'
  | 'numbers'
  | 'files'
  | 'ids'
  | 'aliases'

export const RECALL_SUMMARY_KEYWORD_GROUPS: RecallSummaryKeywordGroup[] = [
  'commands',
  'flags',
  'errors',
  'constants',
  'numbers',
  'files',
  'ids',
  'aliases',
]

export type RecallSummaryKeywordBlock = {
  commands: string[]
  flags: string[]
  errors: string[]
  constants: string[]
  numbers: string[]
  files: string[]
  ids: string[]
  aliases: string[]
}

export type RecallSummaryResult = {
  focus: string
  decisions: string[]
  discoveries: string[]
  patterns: string[]
  tasks: string[]
  files: string[]
  blockers: string[]
  open_questions: string[]
  next_steps: string[]
  confidence: RecallSummaryConfidence
  keywords?: RecallSummaryKeywordBlock
}

const recallSummaryKeywordSchema = z
  .object({
    commands: z.array(z.string()),
    flags: z.array(z.string()),
    errors: z.array(z.string()),
    constants: z.array(z.string()),
    numbers: z.array(z.string()),
    files: z.array(z.string()),
    ids: z.array(z.string()),
    aliases: z.array(z.string()),
  })
  .strict()

const recallSummarySchema = z
  .object({
    focus: z.string(),
    decisions: z.array(z.string()),
    discoveries: z.array(z.string()),
    patterns: z.array(z.string()),
    tasks: z.array(z.string()),
    files: z.array(z.string()),
    blockers: z.array(z.string()),
    open_questions: z.array(z.string()),
    next_steps: z.array(z.string()),
    confidence: z.enum(RECALL_SUMMARY_CONFIDENCE_VALUES),
    keywords: recallSummaryKeywordSchema.nullable(),
  })
  .strict()

const RECALL_SUMMARY_KEYWORD_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: RECALL_SUMMARY_KEYWORD_GROUPS,
  properties: {
    commands: { type: 'array', items: { type: 'string' } },
    flags: { type: 'array', items: { type: 'string' } },
    errors: { type: 'array', items: { type: 'string' } },
    constants: { type: 'array', items: { type: 'string' } },
    numbers: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
    ids: { type: 'array', items: { type: 'string' } },
    aliases: { type: 'array', items: { type: 'string' } },
  },
} as const

export const RECALL_SUMMARY_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: [...RECALL_SUMMARY_FIELDS],
  properties: {
    focus: { type: 'string' },
    decisions: { type: 'array', items: { type: 'string' } },
    discoveries: { type: 'array', items: { type: 'string' } },
    patterns: { type: 'array', items: { type: 'string' } },
    tasks: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
    blockers: { type: 'array', items: { type: 'string' } },
    open_questions: { type: 'array', items: { type: 'string' } },
    next_steps: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string', enum: [...RECALL_SUMMARY_CONFIDENCE_VALUES] },
    keywords: {
      anyOf: [RECALL_SUMMARY_KEYWORD_JSON_SCHEMA, { type: 'null' }],
    },
  },
} as const

export function validateRecallSummaryInput(
  value: unknown,
): RecallSummaryResult {
  const result = recallSummarySchema.safeParse(value)
  if (!result.success) {
    const errors = result.error.issues.map((issue) =>
      formatRecallSummaryIssue(issue),
    )
    throw new Error(
      `Invalid recall summary JSON.\n${errors.map((error) => `- ${error}`).join('\n')}`,
    )
  }
  return {
    ...result.data,
    keywords: result.data.keywords ?? undefined,
  }
}

export function parseRecallSummaryJson(content: string): RecallSummaryResult {
  const json = extractJsonFromText(content)
  let parsed: unknown
  try {
    parsed = JSON.parse(json) as unknown
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Summary response is not valid JSON: ${detail}`)
  }
  return validateRecallSummaryInput(parsed)
}

export function extractJsonFromText(content: string): string {
  const trimmed = content.trim()
  // Fast path: already clean
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    // But verify it parses before returning
    try {
      JSON.parse(trimmed)
      return trimmed
    } catch {
      // Fall through to extraction
    }
  }

  // Remove markdown fences if present
  let cleaned = trimmed
  if (cleaned.startsWith('```')) {
    const firstNewline = cleaned.indexOf('\n')
    if (firstNewline !== -1) {
      cleaned = cleaned.slice(firstNewline + 1)
    }
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3).trimEnd()
  }

  const start = cleaned.indexOf('{')
  if (start === -1) {
    throw new Error(
      'Summary response is not valid JSON: no opening brace found.',
    )
  }

  // Find matching closing brace by counting braces, ignoring braces inside strings
  let depth = 0
  let inString = false
  let escapeNext = false
  let end = -1

  for (let i = start; i < cleaned.length; i++) {
    const char = cleaned[i]
    if (escapeNext) {
      escapeNext = false
      continue
    }
    if (char === '\\') {
      escapeNext = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{') {
      depth++
    } else if (char === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }

  if (end === -1) {
    throw new Error(
      'Summary response is not valid JSON: no matching closing brace found (truncated?).',
    )
  }

  return cleaned.slice(start, end + 1)
}

function formatRecallSummaryIssue(issue: z.ZodIssue): string {
  const location = formatRecallSummaryPath(issue.path)

  if (issue.code === 'unrecognized_keys') {
    return `${location} has unknown fields: ${issue.keys.join(', ')}`
  }

  if (issue.code === 'invalid_enum_value') {
    return `${location} must be one of: ${RECALL_SUMMARY_CONFIDENCE_VALUES.join(
      ', ',
    )}`
  }

  if (issue.code === 'invalid_type' && issue.received === 'undefined') {
    return `${location} is required`
  }

  if (issue.code === 'invalid_type' && issue.expected === 'array') {
    return `${location} must be an array of strings`
  }

  if (issue.code === 'invalid_type' && issue.expected === 'string') {
    return `${location} must be a string`
  }

  return `${location} ${issue.message}`.trim()
}

function formatRecallSummaryPath(path: Array<string | number>): string {
  let output = 'summary'
  for (const segment of path) {
    if (typeof segment === 'number') {
      output += `[${segment}]`
    } else {
      output += `.${segment}`
    }
  }
  return output
}
