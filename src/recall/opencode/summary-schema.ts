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
] as const

export const RECALL_SUMMARY_CONFIDENCE_VALUES = ['low', 'med', 'high'] as const

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
    keywords: recallSummaryKeywordSchema.optional(),
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
    keywords: RECALL_SUMMARY_KEYWORD_JSON_SCHEMA,
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
      `Invalid recall summary JSON.
${errors.map((error) => `- ${error}`).join('\n')}`,
    )
  }
  return result.data
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
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Summary response is not valid JSON.')
  }
  return trimmed.slice(start, end + 1)
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
