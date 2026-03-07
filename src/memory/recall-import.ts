import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { consolidatePreparedInput } from './consolidate'
import { prepareRecallSummaryConsolidationInput } from './consolidation/extract'
import { initMemory } from './init'
import { getWorkspaceContext, memoryPath } from './paths'
import { parseFrontmatter } from '../utils/frontmatter'
import {
  SUMMARY_PREFIX,
  resolveOpencodeDbPath,
  resolveOpencodeOutputDir,
} from '../recall/opencode/paths'
import { parseOpencodeSummary } from '../recall/opencode/summary-parse'

export type RecallImportOptions = {
  summaryDir?: string
  outDir?: string
  dbPath?: string
  projectId?: string
  sessionId?: string
  dryRun?: boolean
}

export type RecallImportSkipped = {
  summaryPath: string
  reason: string
  sessionId?: string
}

export type RecallImportResult = {
  summaryDir: string
  memoryDir: string
  dryRun: boolean
  totalSummaries: number
  imported: number
  skippedExisting: number
  skippedInvalid: number
  skippedFiltered: number
  importedSessions: string[]
  skipped: RecallImportSkipped[]
}

export async function importOpencodeRecall(
  options: RecallImportOptions = {},
): Promise<RecallImportResult> {
  const workspace = getWorkspaceContext()
  const summaryDir = resolveOpencodeOutputDir(
    workspace.workspaceRoot,
    options.summaryDir ?? options.outDir ?? null,
  )
  if (!existsSync(summaryDir)) {
    throw new Error(`Recall summary directory not found: ${summaryDir}`)
  }
  if (options.dbPath) {
    const dbPath = resolveOpencodeDbPath(options.dbPath)
    if (!existsSync(dbPath)) {
      throw new Error(
        `OpenCode sqlite database not found: ${dbPath}. OpenCode 1.2.0+ is required.`,
      )
    }
  }

  initMemory()

  const summaryFiles = listSummaryFiles(summaryDir)
  const memoryDir = resolve(memoryPath('.'))
  const existingSessions = loadImportedSessions(memoryDir)
  const projectFilter = options.projectId?.trim() || null
  const sessionFilter = options.sessionId?.trim() || null
  const importedSessions: string[] = []
  const skipped: RecallImportSkipped[] = []
  let imported = 0
  let skippedExisting = 0
  let skippedInvalid = 0
  let skippedFiltered = 0
  const dryRun = options.dryRun ?? false

  for (const summaryPath of summaryFiles) {
    const content = readFileSync(summaryPath, 'utf-8')
    const parsed = parseOpencodeSummary(content)
    if (!parsed) {
      skippedInvalid += 1
      skipped.push({ summaryPath, reason: 'Missing or invalid summary format' })
      continue
    }
    if (sessionFilter && parsed.sessionId !== sessionFilter) {
      skippedFiltered += 1
      skipped.push({
        summaryPath,
        sessionId: parsed.sessionId,
        reason: `Filtered by session id (${sessionFilter})`,
      })
      continue
    }
    if (projectFilter && parsed.projectId !== projectFilter) {
      skippedFiltered += 1
      skipped.push({
        summaryPath,
        sessionId: parsed.sessionId,
        reason: `Filtered by project id (${projectFilter})`,
      })
      continue
    }
    if (existingSessions.has(parsed.sessionId)) {
      skippedExisting += 1
      skipped.push({
        summaryPath,
        sessionId: parsed.sessionId,
        reason: 'Session already imported',
      })
      continue
    }

    await consolidatePreparedInput(
      prepareRecallSummaryConsolidationInput(parsed, summaryPath),
      { dryRun, skipSourceCleanup: true },
    )

    if (!dryRun) {
      existingSessions.add(parsed.sessionId)
      importedSessions.push(parsed.sessionId)
      imported += 1
    }
  }

  return {
    summaryDir,
    memoryDir,
    dryRun,
    totalSummaries: summaryFiles.length,
    imported,
    skippedExisting,
    skippedInvalid,
    skippedFiltered,
    importedSessions,
    skipped,
  }
}

function listSummaryFiles(summaryDir: string): string[] {
  return readdirSync(summaryDir)
    .filter(
      (fileName) =>
        fileName.startsWith(SUMMARY_PREFIX) && fileName.endsWith('.md'),
    )
    .sort()
    .map((fileName) => join(summaryDir, fileName))
}

function loadImportedSessions(memoryDir: string): Set<string> {
  const sessions = new Set<string>()
  if (!existsSync(memoryDir)) {
    return sessions
  }
  for (const fileName of readdirSync(memoryDir)) {
    if (!/^MEMORY-.*\.md$/.test(fileName)) {
      continue
    }
    const filePath = join(memoryDir, fileName)
    const content = readFileSync(filePath, 'utf-8')
    const { frontmatter } = parseFrontmatter(content)
    const sourceSessions = Array.isArray(frontmatter.source_sessions)
      ? frontmatter.source_sessions.map(String)
      : []
    for (const sessionId of sourceSessions) {
      if (sessionId) {
        sessions.add(sessionId)
      }
    }
  }
  return sessions
}
