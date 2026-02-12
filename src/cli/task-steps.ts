import { z } from 'zod'
import type { TaskStepInput } from '../sdk/types'

const STEP_STATUS_VALUES = [
  'pending',
  'in_progress',
  'completed',
  'skipped',
] as const

const taskStepZodSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    status: z.enum(STEP_STATUS_VALUES).optional(),
    position: z.number().int().nullable().optional(),
    summary: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .strict()

const taskStepsZodSchema = z.array(taskStepZodSchema).min(1)

export const TASK_STEP_TEMPLATE: TaskStepInput[] = [
  {
    title: 'Investigate failure',
    description: 'Reproduce issue and capture logs',
    status: 'pending',
    position: 1,
    summary: null,
    notes: null,
  },
]

export const TASK_STEP_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'array',
  minItems: 1,
  items: {
    type: 'object',
    required: ['title', 'description'],
    additionalProperties: false,
    properties: {
      title: { type: 'string', minLength: 1 },
      description: { type: 'string', minLength: 1 },
      status: { type: 'string', enum: [...STEP_STATUS_VALUES] },
      position: { type: ['integer', 'null'] },
      summary: { type: ['string', 'null'] },
      notes: { type: ['string', 'null'] },
    },
  },
} as const

export function validateTaskStepsInput(value: unknown): TaskStepInput[] {
  if (!Array.isArray(value)) {
    throw new Error(
      'Invalid steps input. Expected a JSON array. Use `continuum task steps template` for an example.',
    )
  }

  const result = taskStepsZodSchema.safeParse(value)
  if (!result.success) {
    const errors: string[] = result.error.issues.map((issue: z.ZodIssue) =>
      formatTaskStepIssue(issue),
    )
    throw new Error(
      `Invalid steps input. Use \`continuum task steps template\` for an example.\n${errors
        .map((error) => `- ${error}`)
        .join('\n')}`,
    )
  }

  return result.data
}

function formatTaskStepIssue(issue: z.ZodIssue): string {
  if (issue.code === 'too_small' && issue.type === 'array') {
    return 'steps must include at least one item'
  }

  const location = formatTaskStepPath(issue.path)

  if (issue.code === 'unrecognized_keys') {
    return `${location} has unknown fields: ${issue.keys.join(', ')}`
  }

  if (issue.code === 'invalid_enum_value') {
    return `${location} must be one of: ${STEP_STATUS_VALUES.join(', ')}`
  }

  if (issue.code === 'invalid_type' && issue.received === 'undefined') {
    return `${location} is required`
  }

  if (issue.code === 'invalid_type' && issue.expected === 'object') {
    return `${location} must be an object`
  }

  if (issue.code === 'invalid_type' && issue.expected === 'integer') {
    return `${location} must be an integer or null`
  }

  if (issue.code === 'invalid_type') {
    if (location.endsWith('.summary') || location.endsWith('.notes')) {
      return `${location} must be a string or null`
    }
    if (location.endsWith('.position')) {
      return `${location} must be an integer or null`
    }
  }

  if (issue.code === 'too_small' && issue.type === 'string') {
    return `${location} must be a non-empty string`
  }

  return `${location} ${issue.message}`.trim()
}

function formatTaskStepPath(path: Array<string | number>): string {
  let output = 'steps'
  for (const segment of path) {
    if (typeof segment === 'number') {
      output += `[${segment}]`
    } else {
      output += `.${segment}`
    }
  }
  return output
}
