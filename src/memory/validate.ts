import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { MEMORY_DIR } from './paths'
import { parseFrontmatter } from '../utils/frontmatter'

export type MemoryValidationError = {
  filePath: string
  lineNumber: number
  message: string
}

export type MemoryValidationResult = {
  errors: MemoryValidationError[]
  filesChecked: number
}

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

export function validateMemory(
  options: { memoryDir?: string } = {},
): MemoryValidationResult {
  const memoryDir = options.memoryDir ?? MEMORY_DIR
  if (!existsSync(memoryDir)) {
    return { errors: [], filesChecked: 0 }
  }

  const errors: MemoryValidationError[] = []
  const files = listMemoryFiles(memoryDir)
  for (const filePath of files) {
    const fileName = filePath.split('/').pop() ?? ''
    if (fileName.startsWith('NOW-')) {
      errors.push(
        ...validateFrontmatter(filePath, NOW_REQUIRED_KEYS, 'NOW', NOW_SCHEMA),
      )
      continue
    }
    if (fileName.startsWith('MEMORY-')) {
      errors.push(
        ...validateFrontmatter(
          filePath,
          MEMORY_REQUIRED_KEYS,
          undefined,
          MEMORY_SCHEMA,
        ),
      )
    }
  }

  const indexPath = join(memoryDir, 'MEMORY.md')
  if (existsSync(indexPath)) {
    errors.push(...validateIndexLinks(indexPath, memoryDir))
  }

  return {
    errors,
    filesChecked: files.length + (existsSync(indexPath) ? 1 : 0),
  }
}

function listMemoryFiles(memoryDir: string): string[] {
  return readdirSync(memoryDir)
    .filter((file) => /^NOW-.*\.md$/.test(file) || /^MEMORY-.*\.md$/.test(file))
    .map((file) => join(memoryDir, file))
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

  if (expectedMemoryType) {
    if (frontmatter.memory_type !== expectedMemoryType) {
      errors.push({
        filePath,
        lineNumber: keyLines.get('memory_type') ?? startLine,
        message: `Invalid memory_type. Expected ${expectedMemoryType}.`,
      })
    }
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

function validateIndexLinks(
  indexPath: string,
  memoryDir: string,
): MemoryValidationError[] {
  const content = readFileSync(indexPath, 'utf-8')
  const lines = content.split('\n')
  const errors: MemoryValidationError[] = []
  const linkRegex = /\[[^\]]+\]\((MEMORY-[^#)]+\.md)#([^)]+)\)/g

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    let match: RegExpExecArray | null
    while ((match = linkRegex.exec(line)) !== null) {
      const fileName = match[1]
      const anchor = match[2]
      const targetPath = join(memoryDir, fileName)
      if (!existsSync(targetPath)) {
        errors.push({
          filePath: indexPath,
          lineNumber: i + 1,
          message: `Missing target file for link: ${fileName}`,
        })
        continue
      }
      if (!anchorExists(targetPath, anchor)) {
        errors.push({
          filePath: indexPath,
          lineNumber: i + 1,
          message: `Missing anchor in ${fileName}: #${anchor}`,
        })
      }
    }
  }

  return errors
}

function anchorExists(filePath: string, anchor: string): boolean {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const namePattern = new RegExp(`name=["']${escapeRegex(anchor)}["']`)
  for (const line of lines) {
    if (namePattern.test(line)) {
      return true
    }
  }
  const headingSlugs = extractHeadingSlugs(lines)
  return headingSlugs.has(anchor)
}

function extractHeadingSlugs(lines: string[]): Set<string> {
  const slugs = new Set<string>()
  const counts = new Map<string, number>()
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)/)
    if (!match) {
      continue
    }
    const heading = match[2].trim()
    if (!heading) {
      continue
    }
    const base = slugifyHeading(heading)
    if (!base) {
      continue
    }
    const existing = counts.get(base) ?? 0
    const slug = existing === 0 ? base : `${base}-${existing}`
    counts.set(base, existing + 1)
    slugs.add(slug)
  }
  return slugs
}

function slugifyHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
