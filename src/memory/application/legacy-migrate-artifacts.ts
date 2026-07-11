import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { parseFrontmatter } from '../../utils/frontmatter'
import type { LegacyMigrationItem } from '../domain/legacy-migration'
import { extractAnchorFromEntry } from '../memory-index'
import { SUMMARY_PREFIX } from '../opencode/paths'
import { parseOpencodeSummary } from '../opencode/summary-parse'
import {
  extractRecentEntries,
  isClearedNowBody,
} from '../recent-content-builders'

export const LEGACY_MIGRATION_VERSION = 2

export type LegacyArtifact = LegacyMigrationItem & {
  absolutePath: string
  checksum: string
  content: string
  duplicateOfDaily?: boolean
}

export function inventoryLegacyArtifacts(
  workspaceRoot: string,
  memoryDir: string,
): LegacyArtifact[] {
  const paths = collectPaths(workspaceRoot, memoryDir)
  const files = paths.sort().map((path) => readArtifact(workspaceRoot, path))
  const dailyIdentities = new Set(
    files
      .filter((item) => item.kind === 'daily-memory')
      .flatMap((item) => contentIdentities(item.content)),
  )
  return files.flatMap((item) =>
    item.kind === 'recent' ? expandRecent(item, dailyIdentities) : [item],
  )
}

export function planLegacyArtifacts(
  artifacts: LegacyArtifact[],
  dbPath: string,
  sqlite?: Database,
): LegacyArtifact[] {
  const previous = readPrevious(dbPath, sqlite)
  return artifacts.map((item) => classify(item, previous))
}

function collectPaths(workspaceRoot: string, memoryDir: string): string[] {
  const paths: string[] = []
  if (existsSync(memoryDir)) {
    for (const name of readdirSync(memoryDir)) {
      if (
        /^NOW-.*\.md$/.test(name) ||
        name === 'RECENT.md' ||
        name === 'MEMORY.md' ||
        /^MEMORY-\d{4}-\d{2}-\d{2}\.md$/.test(name)
      )
        paths.push(join(memoryDir, name))
    }
  }
  const recallDir = join(workspaceRoot, '.continuum', 'recall', 'opencode')
  if (existsSync(recallDir)) collectRecallArtifacts(recallDir, paths)
  return paths
}

function collectRecallArtifacts(directory: string, paths: string[]): void {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) collectRecallArtifacts(path, paths)
    else if (
      name.endsWith('.md') &&
      (name.startsWith(SUMMARY_PREFIX) ||
        name.startsWith('OPENCODE-NORMALIZED-'))
    )
      paths.push(path)
  }
}

function readArtifact(
  workspaceRoot: string,
  absolutePath: string,
): LegacyArtifact {
  const content = readFileSync(absolutePath, 'utf8')
  const name = basename(absolutePath)
  const kind = name.startsWith('NOW-')
    ? 'now'
    : name === 'RECENT.md'
      ? 'recent'
      : name === 'MEMORY.md'
        ? 'memory-index'
        : name.startsWith('MEMORY-')
          ? 'daily-memory'
          : name.startsWith('OPENCODE-NORMALIZED-')
            ? 'opencode-normalized'
            : 'opencode-summary'
  return {
    absolutePath,
    path: normalizePath(relative(workspaceRoot, absolutePath)),
    checksum: fingerprint(content),
    content,
    kind,
    result: 'import',
    detail: '',
  }
}

function expandRecent(
  artifact: LegacyArtifact,
  dailyIdentities: Set<string>,
): LegacyArtifact[] {
  const entries = extractRecentEntries(
    parseFrontmatter(artifact.content).body.split('\n'),
  )
  return entries.map((content, index) => {
    const identities = contentIdentities(content)
    const stableId =
      extractAnchorFromEntry(content) ??
      identities
        .find((identity) => identity.startsWith('session:'))
        ?.slice(8) ??
      fingerprint(content).slice(0, 24)
    return {
      ...artifact,
      path: `${artifact.path}#${stableId || index + 1}`,
      checksum: fingerprint(content),
      content,
      duplicateOfDaily: identities.some((identity) =>
        dailyIdentities.has(identity),
      ),
    }
  })
}

function contentIdentities(content: string): string[] {
  const identities = new Set<string>()
  for (const match of content.matchAll(/(?:#|name=["'])([A-Za-z0-9_-]+)/g))
    if (match[1]?.startsWith('session-')) identities.add(`anchor:${match[1]}`)
  for (const match of content.matchAll(/UTC \(([^)]+)\)/g))
    if (match[1]) identities.add(`session:${match[1].trim()}`)
  identities.add(`fingerprint:${fingerprint(normalizeEntry(content))}`)
  return [...identities]
}

function normalizeEntry(content: string): string {
  return content
    .replace(/^## .*$/gm, '')
    .replace(/<a name=.*?<\/a>/g, '')
    .replace(/^\*\*(?:Link|Source)\*\*:.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function classify(item: LegacyArtifact, previous: Set<string>): LegacyArtifact {
  if (previous.has(migrationKey(item)))
    return { ...item, result: 'skip', detail: 'already migrated' }
  if (item.kind === 'memory-index')
    return { ...item, result: 'skip', detail: 'reference-only index' }
  if (item.kind === 'recent' && item.duplicateOfDaily)
    return {
      ...item,
      result: 'skip',
      detail: 'entry already present in daily MEMORY',
    }
  const parsed = parseFrontmatter(item.content)
  if (item.kind === 'now' && isClearedNowBody(parsed.body, parsed.frontmatter))
    return { ...item, result: 'skip', detail: 'cleared NOW file' }
  if (item.kind === 'opencode-summary' && !parseOpencodeSummary(item.content))
    return {
      ...item,
      result: 'ambiguity',
      detail: 'unrecognized OpenCode summary',
    }
  if (item.kind === 'opencode-normalized' && !readSessionId(item.content))
    return {
      ...item,
      result: 'ambiguity',
      detail: 'unrecognized normalized transcript',
    }
  if (!parsed.body.trim())
    return { ...item, result: 'ambiguity', detail: 'no recoverable content' }
  return {
    ...item,
    result: 'import',
    detail:
      item.kind === 'now'
        ? 'legacy journal entry'
        : item.kind === 'opencode-summary'
          ? 'legacy summary-only recall evidence'
          : item.kind === 'opencode-normalized'
            ? 'legacy normalized recall transcript'
            : 'legacy completed consolidation',
  }
}

function readPrevious(dbPath: string, handle?: Database): Set<string> {
  if (!existsSync(dbPath)) return new Set()
  const sqlite = handle ?? new Database(dbPath, { readonly: true })
  try {
    const table = sqlite
      .query(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_legacy_migrations'",
      )
      .get()
    if (!table) return new Set()
    const rows = sqlite
      .query(
        'SELECT source_path, checksum, migration_version FROM memory_legacy_migrations',
      )
      .all() as Array<{
      source_path: string
      checksum: string
      migration_version: number
    }>
    return new Set(
      rows.map(
        (row) =>
          `${normalizePath(row.source_path)}\0${row.checksum}\0${row.migration_version}`,
      ),
    )
  } finally {
    if (!handle) sqlite.close()
  }
}

export function migrationKey(artifact: LegacyArtifact): string {
  return `${normalizePath(artifact.path)}\0${artifact.checksum}\0${LEGACY_MIGRATION_VERSION}`
}

export function readSessionId(content: string): string | null {
  const value = parseFrontmatter(content).frontmatter.session_id
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function fingerprint(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}
