import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildOpencodeDiffProjectScope,
  buildOpencodeDiffReport,
  buildOpencodeSyncPlan,
  filterOpencodeSourceSessions,
  filterOpencodeSummaryEntries,
  indexOpencodeSummaryEntries,
  listOpencodeSummaryFiles,
  parseOpencodeSummaryFile,
} from '../../../recall/diff/opencode-diff'
import {
  resolveOpencodeSourceIndexFile,
  resolveRecallDataRoot,
  type OpencodeSourceIndex,
} from '../../../recall/index/opencode-source-index'
import { resolveOpencodeOutputDir } from '../../../recall/opencode/paths'
import {
  parseDiffLimit,
  renderRecallDiffReport,
  resolveRecallPath,
  writeJsonFile,
} from './recall-helpers'
import type { RecallDiffOptions } from './recall-subcommands'

type RecallDiffContext = {
  repoPath: string
  indexFile: string
  summaryDir: string
  reportEnabled: boolean
  planEnabled: boolean
  reportPath: string
  planPath: string
  limit: number
}

function buildRecallDiffContext(options: RecallDiffOptions): RecallDiffContext {
  const repoPath = resolve(process.cwd(), options.repo ?? '.')
  const dataRoot = resolveRecallDataRoot(options.dataRoot)
  const summaryDirArg = options.summaryDir ?? options.summaries ?? null

  return {
    repoPath,
    indexFile: resolveOpencodeSourceIndexFile(dataRoot, options.index),
    summaryDir: resolveOpencodeOutputDir(repoPath, summaryDirArg),
    reportEnabled: options.report !== false,
    planEnabled: options.plan !== false,
    reportPath: resolveRecallPath(
      dataRoot,
      typeof options.report === 'string' ? options.report : null,
      'diff-report.json',
    ),
    planPath: resolveRecallPath(
      dataRoot,
      typeof options.plan === 'string' ? options.plan : null,
      'sync-plan.json',
    ),
    limit: parseDiffLimit(options.limit),
  }
}

function maybeWriteRecallDiffArtifacts(
  report: ReturnType<typeof buildOpencodeDiffReport>,
  context: RecallDiffContext,
): void {
  if (context.reportEnabled) {
    writeJsonFile(context.reportPath, report)
  }

  if (!context.planEnabled) {
    return
  }

  const plan = buildOpencodeSyncPlan(
    report,
    context.reportEnabled ? context.reportPath : null,
  )
  writeJsonFile(context.planPath, plan)
}

export function handleRecallDiff(options: RecallDiffOptions): void {
  const context = buildRecallDiffContext(options)
  if (!existsSync(context.indexFile)) {
    throw new Error(`Source index not found: ${context.indexFile}`)
  }

  const sourceIndex = JSON.parse(
    readFileSync(context.indexFile, 'utf-8'),
  ) as OpencodeSourceIndex
  const projectScope = buildOpencodeDiffProjectScope(
    sourceIndex,
    context.repoPath,
    options.project ?? null,
    options.includeGlobal ?? false,
  )
  const scopedSourceIndex: OpencodeSourceIndex = {
    ...sourceIndex,
    sessions: filterOpencodeSourceSessions(
      sourceIndex.sessions ?? {},
      projectScope.project_ids,
    ),
  }
  const summaryEntries = listOpencodeSummaryFiles(context.summaryDir)
    .map((filePath) => parseOpencodeSummaryFile(filePath))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
  const scopedSummaryEntries = filterOpencodeSummaryEntries(
    summaryEntries,
    projectScope.project_ids,
  )
  const summaryIndex = indexOpencodeSummaryEntries(scopedSummaryEntries)
  const report = buildOpencodeDiffReport(
    scopedSourceIndex,
    summaryIndex,
    context.summaryDir,
    projectScope,
  )
  maybeWriteRecallDiffArtifacts(report, context)

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  const pathLines: string[] = []
  if (context.reportEnabled) {
    pathLines.push(`Report file: ${context.reportPath}`)
  }
  if (context.planEnabled) {
    pathLines.push(`Plan file: ${context.planPath}`)
  }
  const prefix = pathLines.length > 0 ? `${pathLines.join('\n')}\n` : ''
  console.log(`${prefix}${renderRecallDiffReport(report, context.limit)}`)
}
