import { readFileSync } from 'node:fs'
import { parseFrontmatter } from '../utils/frontmatter'
import type { MemoryValidationError } from './validate'

type SchemaRule = {
  kind: 'string' | 'number' | 'string-array' | 'timestamp'
  nullable?: boolean
  allowed?: string[]
}

const NOW_REQUIRED_KEYS = [
  'session_id',
  'timestamp_start',
  'timestamp_end',
  'duration_minutes',
  'project_path',
  'tags',
  'parent_session',
  'related_tasks',
  'memory_type',
]

const MEMORY_REQUIRED_KEYS = [
  'consolidation_date',
  'source_sessions',
  'total_sessions_consolidated',
  'tags',
  'consolidated_by',
]

const NOW_SCHEMA: Record<string, SchemaRule> = {
  session_id: { kind: 'string' },
  timestamp_start: { kind: 'timestamp' },
  timestamp_end: { kind: 'timestamp', nullable: true },
  duration_minutes: { kind: 'number', nullable: true },
  project_path: { kind: 'string' },
  tags: { kind: 'string-array' },
  parent_session: { kind: 'string', nullable: true },
  related_tasks: { kind: 'string-array' },
  memory_type: { kind: 'string', allowed: ['NOW'] },
}

const MEMORY_SCHEMA: Record<string, SchemaRule> = {
  consolidation_date: { kind: 'timestamp' },
  source_sessions: { kind: 'string-array' },
  total_sessions_consolidated: { kind: 'number' },
  tags: { kind: 'string-array' },
  consolidated_by: { kind: 'string' },
}

export function validateNowMemoryFrontmatter(
  filePath: string,
): MemoryValidationError[] {
  return validateFrontmatter(filePath, NOW_REQUIRED_KEYS, 'NOW', NOW_SCHEMA)
}

export function validateConsolidatedMemoryFrontmatter(
  filePath: string,
): MemoryValidationError[] {
  return validateFrontmatter(
    filePath,
    MEMORY_REQUIRED_KEYS,
    undefined,
    MEMORY_SCHEMA,
  )
}

function validateFrontmatter(
  filePath: string,
  requiredKeys: string[],
  expectedMemoryType?: string,
  schema?: Record<string, SchemaRule>,
): MemoryValidationError[] {
  const content = readFileSync(filePath, 'utf-8')
  const { frontmatter, hasFrontmatter } = parseFrontmatter(content)
  const { keyLines, startLine } = extractFrontmatterLineInfo(content)
  const errors: MemoryValidationError[] = []

  if (!hasFrontmatter) {
    errors.push({
      filePath,
      lineNumber: 1,
      message: 'Missing YAML frontmatter block.',
    })
    return errors
  }

  for (const key of requiredKeys) {
    if (!(key in frontmatter)) {
      errors.push({
        filePath,
        lineNumber: keyLines.get(key) ?? startLine,
        message: `Missing frontmatter key: ${key}`,
      })
    }
  }

  if (expectedMemoryType && frontmatter.memory_type !== expectedMemoryType) {
    errors.push({
      filePath,
      lineNumber: keyLines.get('memory_type') ?? startLine,
      message: `Invalid memory_type. Expected ${expectedMemoryType}.`,
    })
  }

  if (schema) {
    errors.push(
      ...validateFrontmatterSchema(
        filePath,
        frontmatter,
        keyLines,
        startLine,
        schema,
      ),
    )
  }

  return errors
}

function validateFrontmatterSchema(
  filePath: string,
  frontmatter: Record<string, unknown>,
  keyLines: Map<string, number>,
  startLine: number,
  schema: Record<string, SchemaRule>,
): MemoryValidationError[] {
  const errors: MemoryValidationError[] = []
  for (const [key, rule] of Object.entries(schema)) {
    if (!(key in frontmatter)) {
      continue
    }
    const value = frontmatter[key]
    if (value === null && rule.nullable) {
      continue
    }
    const error = validateValue(rule, value)
    if (!error) {
      continue
    }
    errors.push({
      filePath,
      lineNumber: keyLines.get(key) ?? startLine,
      message: `Invalid frontmatter value for ${key}. Expected ${error}.`,
    })
  }
  return errors
}

function validateValue(rule: SchemaRule, value: unknown): string | null {
  if (rule.kind === 'string') {
    if (typeof value !== 'string') {
      return rule.nullable ? 'string or null' : 'string'
    }
    if (rule.allowed && !rule.allowed.includes(value)) {
      return `one of: ${rule.allowed.join(', ')}`
    }
    return null
  }
  if (rule.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return rule.nullable ? 'number or null' : 'number'
    }
    return null
  }
  if (rule.kind === 'string-array') {
    if (!Array.isArray(value)) {
      return 'array of strings'
    }
    if (!value.every((item) => typeof item === 'string')) {
      return 'array of strings'
    }
    return null
  }
  if (rule.kind === 'timestamp') {
    if (typeof value !== 'string') {
      return rule.nullable ? 'timestamp or null' : 'timestamp'
    }
    if (Number.isNaN(Date.parse(value))) {
      return rule.nullable ? 'timestamp or null' : 'timestamp'
    }
    return null
  }
  return null
}

function extractFrontmatterLineInfo(content: string): {
  startLine: number
  keyLines: Map<string, number>
} {
  const lines = content.split('\n')
  if (lines.length === 0 || lines[0].trim() !== '---') {
    return { startLine: 1, keyLines: new Map() }
  }

  const keyLines = new Map<string, number>()
  let endIndex = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      endIndex = i
      break
    }
    const line = lines[i]
    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) {
      continue
    }
    const key = line.slice(0, separatorIndex).trim()
    if (key) {
      keyLines.set(key, i + 1)
    }
  }

  const startLine = endIndex === -1 ? 1 : 2
  return { startLine, keyLines }
}
