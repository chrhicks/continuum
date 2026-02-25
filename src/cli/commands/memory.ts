import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Command } from 'commander'
import { initMemory } from '../../memory/init'
import {
  resolveCurrentSessionPath,
  startSession,
  endSession,
} from '../../memory/session'
import { consolidateNow } from '../../memory/consolidate'
import { getStatus } from '../../memory/status'
import {
  appendAgentMessage,
  appendToolCall,
  appendUserMessage,
} from '../../memory/now-writer'
import { searchMemory, type MemorySearchTier } from '../../memory/search'
import { searchRecall, type RecallSearchMode } from '../../recall/search'
import { resolveOpencodeOutputDir } from '../../recall/opencode/paths'
import {
  buildOpencodeSourceIndex,
  resolveOpencodeSourceIndexFile,
  resolveRecallDataRoot,
  type OpencodeSourceIndex,
} from '../../recall/index/opencode-source-index'
import {
  buildOpencodeDiffProjectScope,
  buildOpencodeDiffReport,
  buildOpencodeSyncPlan,
  filterOpencodeSourceSessions,
  filterOpencodeSummaryEntries,
  indexOpencodeSummaryEntries,
  listOpencodeSummaryFiles,
  parseOpencodeSummaryFile,
  type OpencodeDiffEntry,
  type OpencodeDiffReport,
} from '../../recall/diff/opencode-diff'
import {
  buildOpencodeSyncLedger,
  runOpencodeSyncPlan,
  updateOpencodeSyncLedger,
  type OpencodeSyncLedger,
} from '../../recall/sync/opencode-sync'
import { validateMemory } from '../../memory/validate'
import { readConsolidationLog } from '../../memory/log'
import { recoverStaleNowFiles } from '../../memory/recover'
import { listMemoryEntries } from '../../memory/list'
import { importOpencodeRecall } from '../../memory/recall-import'
import { handleLoop } from './loop'

const DEFAULT_SYNC_PROCESSED_VERSION = 1

export function createMemoryCommand(): Command {
  const memoryCommand = new Command('memory').description(
    'Memory management commands',
  )

  memoryCommand.action(() => {
    memoryCommand.outputHelp()
  })

  memoryCommand
    .command('init')
    .description('Initialize memory system')
    .action(() => {
      initMemory()
      console.log('Memory initialized at .continuum/memory/')
    })

  const sessionCommand = new Command('session').description(
    'Session management commands',
  )

  sessionCommand.action(() => {
    sessionCommand.outputHelp()
  })

  sessionCommand
    .command('start')
    .description('Start a new session')
    .action(() => {
      const info = startSession()
      console.log(`Session started: ${info.sessionId}`)
      console.log(`NOW file: ${info.filePath}`)
    })

  sessionCommand
    .command('end')
    .description('End the current session')
    .option('--consolidate', 'Consolidate after ending session')
    .action(async (options: { consolidate?: boolean }) => {
      const path = endSession()
      console.log(`Session ended: ${path}`)
      if (options.consolidate) {
        const result = await consolidateNow()
        logConsolidationResult(result)
      }
    })

  sessionCommand
    .command('append')
    .description('Append message to current session')
    .argument('<kind>')
    .argument('<text...>')
    .action(async (kind: string, textParts: string[]) => {
      await handleAppend(kind, textParts)
    })

  memoryCommand.addCommand(sessionCommand)

  memoryCommand
    .command('status')
    .description('Show memory status')
    .action(() => {
      handleStatus()
    })

  memoryCommand
    .command('list')
    .description('List memory files')
    .action(() => {
      handleList()
    })

  const recallCommand = new Command('recall').description(
    'Recall import commands',
  )

  recallCommand.action(() => {
    recallCommand.outputHelp()
  })

  recallCommand
    .command('import')
    .description('Import OpenCode recall summaries into memory')
    .option(
      '--summary-dir <dir>',
      'Directory containing opencode recall summaries',
    )
    .option('--out <dir>', 'Alias for --summary-dir')
    .option('--db <path>', 'OpenCode sqlite database path')
    .option('--project <id>', 'Filter by OpenCode project id')
    .option('--session <id>', 'Filter by OpenCode session id')
    .option('--dry-run', 'Preview import without writing files')
    .action(
      (options: {
        summaryDir?: string
        out?: string
        db?: string
        project?: string
        session?: string
        dryRun?: boolean
      }) => {
        handleRecallImport(options)
      },
    )

  recallCommand
    .command('index')
    .description('Build recall source index from OpenCode storage')
    .option('--db <path>', 'OpenCode sqlite database path')
    .option(
      '--data-root <path>',
      'Continuum data root (default: $XDG_DATA_HOME/continuum)',
    )
    .option(
      '--index <path>',
      'Output index file (default: <data-root>/recall/opencode/source-index.json)',
    )
    .option('--project <id>', 'Limit to a single project id')
    .option('--session <id>', 'Limit to a single session id')
    .option('--verbose', 'Print progress details')
    .action(
      (options: {
        db?: string
        dataRoot?: string
        index?: string
        project?: string
        session?: string
        verbose?: boolean
      }) => {
        handleRecallIndex(options)
      },
    )

  recallCommand
    .command('diff')
    .description('Compare recall summaries to source index')
    .option(
      '--index <path>',
      'Source index file (default: $XDG_DATA_HOME/continuum/recall/opencode/source-index.json)',
    )
    .option(
      '--data-root <path>',
      'Continuum data root (default: $XDG_DATA_HOME/continuum)',
    )
    .option('--repo <path>', 'Repo root (default: cwd)')
    .option(
      '--summary-dir <dir>',
      'Summary dir (default: <repo>/.continuum/recall/opencode)',
    )
    .option('--summaries <dir>', 'Alias for --summary-dir')
    .option('--limit <n>', 'Limit items per section', '10')
    .option('--json', 'Output JSON report to stdout')
    .option(
      '--report <path>',
      'Write JSON report to file (default: <data-root>/recall/opencode/diff-report.json)',
    )
    .option('--no-report', 'Skip writing the report file')
    .option(
      '--plan <path>',
      'Write sync plan file (default: <data-root>/recall/opencode/sync-plan.json)',
    )
    .option('--no-plan', 'Skip writing the sync plan file')
    .option('--project <id>', 'Limit to a single project id')
    .option('--include-global', 'Include global sessions in scope')
    .action(
      (options: {
        index?: string
        dataRoot?: string
        repo?: string
        summaryDir?: string
        summaries?: string
        limit?: string
        json?: boolean
        report?: string | boolean
        plan?: string | boolean
        project?: string
        includeGlobal?: boolean
      }) => {
        handleRecallDiff(options)
      },
    )

  recallCommand
    .command('sync')
    .description('Execute recall sync plan')
    .option(
      '--plan <path>',
      'Sync plan file (default: <data-root>/recall/opencode/sync-plan.json)',
    )
    .option(
      '--ledger <path>',
      'Ledger file (default: <data-root>/recall/opencode/state.json)',
    )
    .option(
      '--log <path>',
      'Append sync log to file (default: <data-root>/recall/opencode/sync-log.jsonl)',
    )
    .option(
      '--data-root <path>',
      'Continuum data root (default: $XDG_DATA_HOME/continuum)',
    )
    .option(
      '--command <template>',
      'Command template (supports {session_id}, {project_id}, {key})',
    )
    .option('--cwd <path>', 'Working directory for commands (default: cwd)')
    .option('--dry-run', 'Skip execution and ledger updates')
    .option('--fail-fast', 'Stop on first failure')
    .option('--limit <n>', 'Limit number of items processed')
    .option(
      '--processed-version <n>',
      `Ledger processed version (default: ${DEFAULT_SYNC_PROCESSED_VERSION})`,
    )
    .option('--verbose', 'Print per-item results')
    .action(
      (options: {
        plan?: string
        ledger?: string
        log?: string
        dataRoot?: string
        command?: string
        cwd?: string
        dryRun?: boolean
        failFast?: boolean
        limit?: string
        processedVersion?: string
        verbose?: boolean
      }) => {
        handleRecallSync(options)
      },
    )

  recallCommand
    .command('search')
    .description('Search recall summaries')
    .argument('<query...>')
    .option(
      '--mode <mode>',
      'Search mode: bm25, semantic (tf-idf), auto',
      'auto',
    )
    .option(
      '--summary-dir <dir>',
      'Directory containing opencode recall summaries',
    )
    .option('--limit <limit>', 'Maximum results to return', '5')
    .action(
      (
        queryParts: string[],
        options: { mode?: string; summaryDir?: string; limit?: string },
      ) => {
        const query = queryParts.join(' ').trim()
        if (!query) {
          throw new Error('Missing search query.')
        }
        handleRecallSearch(query, options)
      },
    )

  memoryCommand.addCommand(recallCommand)

  memoryCommand
    .command('consolidate')
    .description('Consolidate memory files')
    .option('--dry-run', 'Preview consolidation without writing files')
    .action((options: { dryRun?: boolean }) => {
      handleConsolidate(options.dryRun ?? false)
    })

  memoryCommand
    .command('append')
    .description('Append message to current session')
    .argument('<kind>')
    .argument('<text...>')
    .action(async (kind: string, textParts: string[]) => {
      await handleAppend(kind, textParts)
    })

  memoryCommand
    .command('search')
    .description('Search memory content')
    .argument('<query...>')
    .option('--tier <tier>', 'Search tier: NOW, RECENT, MEMORY, or all')
    .option('--tags <tags>', 'Filter by tags (comma-separated)')
    .action(
      (queryParts: string[], options: { tier?: string; tags?: string }) => {
        const query = queryParts.join(' ').trim()
        if (!query) {
          throw new Error('Missing search query.')
        }
        const tier = options.tier ? parseSearchTier(options.tier) : 'all'
        const tags = options.tags ? parseSearchTags(options.tags) : []
        handleSearch(query, tier, tags)
      },
    )

  memoryCommand
    .command('log')
    .description('View consolidation log')
    .option('--tail <lines>', 'Show last N lines')
    .action((options: { tail?: string }) => {
      const tail = options.tail ? parseTail(options.tail) : undefined
      handleLog(tail)
    })

  memoryCommand
    .command('recover')
    .description('Recover stale NOW sessions')
    .option('--hours <hours>', 'Maximum age in hours')
    .option('--consolidate', 'Consolidate recovered sessions')
    .action((options: { hours?: string; consolidate?: boolean }) => {
      const hours = options.hours ? parseHours(options.hours) : undefined
      handleRecover(hours, options.consolidate ?? false)
    })

  memoryCommand
    .command('validate')
    .description('Validate memory structure')
    .action(() => {
      handleValidate()
    })

  memoryCommand
    .command('loop')
    .description('Run loop request')
    .requiredOption('-n, --count <count>', 'Number of iterations')
    .action(async (options: { count: string }) => {
      const count = parseLoopCount(options.count)
      await handleLoop(count)
    })

  return memoryCommand
}

export async function endSessionIfActive(options: {
  consolidate: boolean
}): Promise<string | null> {
  if (!resolveCurrentSessionPath({ allowFallback: true })) {
    return null
  }
  const path = endSession()
  if (options.consolidate) {
    const result = await consolidateNow()
    logConsolidationResult(result)
  }
  return path
}

function handleStatus(): void {
  const status = getStatus()
  console.log('Memory status:')
  console.log(`- NOW file: ${status.nowPath ?? 'none'}`)
  console.log(`- NOW lines: ${status.nowLines}`)
  console.log(`- NOW age (minutes): ${status.nowAgeMinutes ?? 'n/a'}`)
  console.log(`- NOW size: ${formatBytes(status.nowBytes)}`)
  console.log(`- RECENT lines: ${status.recentLines}`)
  console.log(`- Memory size: ${formatBytes(status.memoryBytes)}`)
  console.log(`- Last consolidation: ${status.lastConsolidation ?? 'n/a'}`)
}

function handleList(): void {
  const entries = listMemoryEntries()
  if (entries.length === 0) {
    console.log('No memory files found.')
    return
  }

  console.log('Memory files:')
  for (const entry of entries) {
    const ageMinutes = Math.max(
      0,
      Math.round((Date.now() - entry.mtimeMs) / 60000),
    )
    const ageLabel = formatAgeMinutes(ageMinutes)
    const currentLabel = entry.isCurrent ? 'current, ' : ''
    console.log(
      `- ${entry.kind}: ${entry.fileName} (${currentLabel}${formatBytes(
        entry.sizeBytes,
      )}, ${ageLabel} old)`,
    )
  }
}

async function handleConsolidate(dryRun: boolean): Promise<void> {
  const result = await consolidateNow({ dryRun })
  logConsolidationResult(result)
}

type ConsolidationResult = Awaited<ReturnType<typeof consolidateNow>>

function logConsolidationResult(result: ConsolidationResult): void {
  if (result.dryRun && result.preview) {
    console.log('Consolidation dry run (no files written):')
    console.log(
      `- RECENT: ${result.recentPath} (${result.preview.recentLines} lines)`,
    )
    console.log(
      `- MEMORY: ${result.memoryPath} (${result.preview.memoryLines} lines)`,
    )
    console.log(
      `- INDEX: ${result.memoryIndexPath} (${result.preview.memoryIndexLines} lines)`,
    )
    console.log(`- LOG: ${result.logPath} (+${result.preview.logLines} lines)`)
    console.log(`- NOW: ${result.nowPath} (${result.preview.nowLines} lines)`)
    return
  }

  console.log('Consolidation complete:')
  console.log(`- RECENT: ${result.recentPath}`)
  console.log(`- MEMORY: ${result.memoryPath}`)
  console.log(`- INDEX: ${result.memoryIndexPath}`)
  console.log(`- LOG: ${result.logPath}`)
}

function handleSearch(
  query: string,
  tier: MemorySearchTier | 'all',
  tags: string[],
): void {
  const result = searchMemory(query, tier, tags)
  if (result.filesSearched === 0) {
    console.log('No memory files found.')
    return
  }
  if (result.matches.length === 0) {
    console.log(`No matches found for "${query}".`)
    console.log(`Files searched: ${result.filesSearched}`)
    return
  }

  const matchLabel = result.matches.length === 1 ? 'match' : 'matches'
  const fileLabel = result.filesSearched === 1 ? 'file' : 'files'
  console.log(
    `Found ${result.matches.length} ${matchLabel} in ${result.filesSearched} ${fileLabel}:`,
  )
  for (const match of result.matches) {
    console.log(`- ${match.filePath}:${match.lineNumber} ${match.lineText}`)
  }
}

function handleValidate(): void {
  const result = validateMemory()
  if (result.filesChecked === 0) {
    console.log('No memory files found.')
    return
  }
  if (result.errors.length === 0) {
    console.log(
      `Memory validation passed (${result.filesChecked} files checked).`,
    )
    return
  }

  console.error(
    `Memory validation failed with ${result.errors.length} issue(s):`,
  )
  for (const error of result.errors) {
    console.error(`- ${error.filePath}:${error.lineNumber} ${error.message}`)
  }
  process.exitCode = 1
}

async function handleRecallImport(options: {
  summaryDir?: string
  out?: string
  db?: string
  project?: string
  session?: string
  dryRun?: boolean
}): Promise<void> {
  const result = await importOpencodeRecall({
    summaryDir: options.summaryDir,
    outDir: options.out,
    dbPath: options.db,
    projectId: options.project,
    sessionId: options.session,
    dryRun: options.dryRun,
  })

  if (result.totalSummaries === 0) {
    console.log(`No opencode recall summaries found in ${result.summaryDir}.`)
    return
  }

  const dryRunLabel = result.dryRun ? ' (dry run)' : ''
  console.log(`Recall import${dryRunLabel}:`)
  console.log(`- Summary dir: ${result.summaryDir}`)
  console.log(`- Summaries: ${result.totalSummaries}`)
  console.log(`- Imported: ${result.imported}`)
  console.log(`- Skipped (existing): ${result.skippedExisting}`)
  console.log(`- Skipped (invalid): ${result.skippedInvalid}`)
  if (result.skippedFiltered > 0) {
    console.log(`- Skipped (filtered): ${result.skippedFiltered}`)
  }

  if (result.importedSessions.length > 0) {
    console.log(`- Sessions: ${result.importedSessions.join(', ')}`)
  }

  if (result.skipped.length > 0) {
    console.log('Skipped summaries:')
    for (const entry of result.skipped) {
      const label = entry.sessionId ? ` (${entry.sessionId})` : ''
      console.log(`- ${entry.summaryPath}${label}: ${entry.reason}`)
    }
  }
}

function handleRecallIndex(options: {
  db?: string
  dataRoot?: string
  index?: string
  project?: string
  session?: string
  verbose?: boolean
}): void {
  const index = buildOpencodeSourceIndex({
    dbPath: options.db,
    dataRoot: options.dataRoot,
    indexFile: options.index,
    projectId: options.project,
    sessionId: options.session,
  })

  if (options.verbose) {
    for (const entry of Object.values(index.sessions)) {
      console.log(`Indexed ${entry.key} (${entry.message_count} messages)`)
    }
  }

  writeJsonFile(index.index_file, index)
  console.log(`Source index written: ${index.index_file}`)
  console.log(
    `Sessions indexed: ${index.stats.session_count} (projects: ${index.stats.project_count})`,
  )
}

function handleRecallDiff(options: {
  index?: string
  dataRoot?: string
  repo?: string
  summaryDir?: string
  summaries?: string
  limit?: string
  json?: boolean
  report?: string | boolean
  plan?: string | boolean
  project?: string
  includeGlobal?: boolean
}): void {
  const repoPath = resolve(process.cwd(), options.repo ?? '.')
  const dataRoot = resolveRecallDataRoot(options.dataRoot)
  const indexFile = resolveOpencodeSourceIndexFile(dataRoot, options.index)
  const limit = parseDiffLimit(options.limit)
  const summaryDirArg = options.summaryDir ?? options.summaries ?? null
  const summaryDir = resolveOpencodeOutputDir(repoPath, summaryDirArg)
  const reportEnabled = options.report !== false
  const planEnabled = options.plan !== false
  const reportPath = resolveDiffReportPath(
    dataRoot,
    typeof options.report === 'string' ? options.report : null,
  )
  const planPath = resolveSyncPlanPath(
    dataRoot,
    typeof options.plan === 'string' ? options.plan : null,
  )

  if (!existsSync(indexFile)) {
    throw new Error(`Source index not found: ${indexFile}`)
  }

  const sourceIndex = JSON.parse(
    readFileSync(indexFile, 'utf-8'),
  ) as OpencodeSourceIndex

  const projectScope = buildOpencodeDiffProjectScope(
    sourceIndex,
    repoPath,
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

  const summaryEntries = listOpencodeSummaryFiles(summaryDir)
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
    summaryDir,
    projectScope,
  )

  if (reportEnabled) {
    writeJsonFile(reportPath, report)
  }

  const plan = planEnabled
    ? buildOpencodeSyncPlan(report, reportEnabled ? reportPath : null)
    : null
  if (planEnabled && plan) {
    writeJsonFile(planPath, plan)
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  const pathLines: string[] = []
  if (reportEnabled) {
    pathLines.push(`Report file: ${reportPath}`)
  }
  if (planEnabled) {
    pathLines.push(`Plan file: ${planPath}`)
  }
  const prefix = pathLines.length > 0 ? `${pathLines.join('\n')}\n` : ''
  console.log(`${prefix}${renderRecallDiffReport(report, limit)}`)
}

function handleRecallSync(options: {
  plan?: string
  ledger?: string
  log?: string
  dataRoot?: string
  command?: string
  cwd?: string
  dryRun?: boolean
  failFast?: boolean
  limit?: string
  processedVersion?: string
  verbose?: boolean
}): void {
  const dataRoot = resolveRecallDataRoot(options.dataRoot)
  const ledgerPath = resolveSyncLedgerPath(dataRoot, options.ledger ?? null)
  const logPath = resolveSyncLogPath(dataRoot, options.log ?? null)
  const limit = parseSyncLimit(options.limit)
  const processedVersion = parseProcessedVersion(options.processedVersion)

  const result = runOpencodeSyncPlan({
    planPath: options.plan ?? null,
    dataRoot,
    commandTemplate: options.command ?? null,
    cwd: options.cwd ?? null,
    dryRun: options.dryRun,
    failFast: options.failFast,
    limit,
  })

  const now = new Date().toISOString()
  const shouldWriteLedger = !result.dryRun && result.results.length > 0
  let ledgerWritten = false

  if (shouldWriteLedger) {
    const existingLedger = existsSync(ledgerPath)
      ? (JSON.parse(readFileSync(ledgerPath, 'utf-8')) as OpencodeSyncLedger)
      : null
    const baseLedger =
      existingLedger ??
      buildOpencodeSyncLedger(result.plan, processedVersion, now)
    const nextLedger: OpencodeSyncLedger = {
      ...baseLedger,
      processed_version: processedVersion,
    }
    const updatedLedger = updateOpencodeSyncLedger(
      nextLedger,
      result.results,
      now,
    )
    writeJsonFile(ledgerPath, updatedLedger)
    ledgerWritten = true
  }

  const runCwd = resolve(process.cwd(), options.cwd ?? '.')
  appendJsonLine(logPath, {
    generated_at: now,
    plan_path: result.planPath,
    ledger_path: ledgerPath,
    command_template: result.commandTemplate,
    command_appended: result.commandAppended,
    warning: result.warning,
    dry_run: result.dryRun,
    fail_fast: Boolean(options.failFast),
    limit,
    cwd: runCwd,
    processed_version: processedVersion,
    items_processed: result.results.length,
    summary: result.summary,
    results: result.results,
    ledger_written: ledgerWritten,
  })

  if (result.commandAppended) {
    console.log('Note: appended --project {project_id} to command template.')
  }
  if (result.warning) {
    console.log(`Warning: ${result.warning}`)
  }

  if (options.verbose) {
    for (const entry of result.results) {
      const label = entry.status.toUpperCase()
      const commandLabel = entry.command ? ` command=${entry.command}` : ''
      console.log(`${label}: ${entry.item.key}${commandLabel}`)
    }
  }

  console.log(`Plan file: ${result.planPath}`)
  if (ledgerWritten) {
    console.log(`Ledger file: ${ledgerPath}`)
  }
  console.log(`Sync log: ${logPath}`)
  if (result.dryRun && !result.commandTemplate) {
    console.log('Dry-run: missing --command, no execution performed.')
  }
  console.log(`Items processed: ${result.results.length}`)
  console.log(`- success: ${result.summary.success}`)
  console.log(`- failed: ${result.summary.failed}`)
  console.log(`- skipped: ${result.summary.skipped}`)
}

function handleRecallSearch(
  query: string,
  options: { mode?: string; summaryDir?: string; limit?: string },
): void {
  const mode = parseRecallMode(options.mode)
  const limit = parseRecallLimit(options.limit)
  const result = searchRecall({
    query,
    mode,
    summaryDir: options.summaryDir,
    limit,
  })

  if (result.filesSearched === 0) {
    console.log(`No opencode recall summaries found in ${result.summaryDir}.`)
    return
  }

  const modeLabel = formatRecallModeLabel(result.mode)
  const modeOutput = result.fallback ? `${modeLabel} (fallback)` : modeLabel

  console.log('Recall search:')
  console.log(`- Mode: ${modeOutput}`)
  console.log(`- Summary dir: ${result.summaryDir}`)
  console.log(`- Files searched: ${result.filesSearched}`)
  console.log(`- Results: ${result.results.length}`)

  if (result.results.length === 0) {
    console.log(`No matches found for "${query}".`)
    return
  }

  for (const match of result.results) {
    const score = formatScore(match.score)
    const sessionLabel = match.sessionId ? ` [${match.sessionId}]` : ''
    const titleLabel = match.title ? ` (${match.title})` : ''
    const snippetLabel = match.snippet ? ` - ${match.snippet}` : ''
    console.log(
      `- [${score}] ${match.filePath}${sessionLabel}${titleLabel}${snippetLabel}`,
    )
  }
}

function renderRecallDiffReport(
  report: OpencodeDiffReport,
  limit: number,
): string {
  const lines: string[] = []
  lines.push(`Source index: ${report.index_file}`)
  lines.push(`Summary dir: ${report.summary_dir}`)
  lines.push(`Project scope: ${report.project_scope.project_ids.join(', ')}`)
  lines.push(`Source sessions: ${report.stats.source_sessions}`)
  lines.push(
    `Local summaries: ${report.stats.local_summaries} (duplicates: ${report.stats.local_duplicates})`,
  )
  lines.push('Diff:')
  lines.push(`- new: ${report.stats.new}`)
  lines.push(`- stale: ${report.stats.stale}`)
  lines.push(`- unchanged: ${report.stats.unchanged}`)
  lines.push(`- orphan: ${report.stats.orphan}`)
  lines.push(`- unknown: ${report.stats.unknown}`)
  lines.push('')

  lines.push(...renderRecallDiffSection('New', report.new, limit))
  lines.push(...renderRecallDiffSection('Stale', report.stale, limit))
  lines.push(...renderRecallDiffSection('Orphan', report.orphan, limit))
  lines.push(...renderRecallDiffSection('Unknown', report.unknown, limit))

  if (report.stats.local_duplicates > 0) {
    const duplicateSuffix =
      limit > 0 && report.duplicates.length > limit ? `, showing ${limit}` : ''
    lines.push(
      `Duplicates (${report.stats.local_duplicates}${duplicateSuffix})`,
    )
    const rows = report.duplicates.slice(0, limit).map((entry) => {
      return `- ${entry.key} | kept=${entry.kept} | dropped=${entry.dropped}`
    })
    lines.push(...rows, '')
  }

  return lines.join('\n').trimEnd() + '\n'
}

function renderRecallDiffSection(
  label: string,
  entries: OpencodeDiffEntry[],
  limit: number,
): string[] {
  const showing = entries.slice(0, limit)
  const headerSuffix =
    limit > 0 && entries.length > limit ? `, showing ${limit}` : ''
  const header = `${label} (${entries.length}${headerSuffix})`
  if (showing.length === 0) {
    return [header, '- none', '']
  }

  const rows = showing.map((entry) => {
    const title = entry.title ?? 'untitled'
    const sourceUpdated = entry.source_updated_at ?? 'n/a'
    const summaryGenerated = entry.summary_generated_at ?? 'n/a'
    return `- ${entry.key} | ${title} | source_updated_at=${sourceUpdated} | summary_generated_at=${summaryGenerated}`
  })

  return [header, ...rows, '']
}

function handleLog(tail?: number): void {
  const result = readConsolidationLog({ tail })
  if (result.totalLines === 0) {
    console.log('No consolidation log entries found.')
    return
  }

  const tailLabel = result.truncated
    ? ` (showing last ${result.lines.length} of ${result.totalLines} lines)`
    : ''
  console.log(`Consolidation log${tailLabel}:`)
  console.log(`- Path: ${result.filePath}`)
  console.log(result.lines.join('\n'))
}

async function handleRecover(
  maxHours: number | undefined,
  consolidate: boolean,
): Promise<void> {
  const result = await recoverStaleNowFiles({ maxHours, consolidate })
  if (result.totalNowFiles === 0) {
    console.log('No NOW files found.')
    return
  }
  if (result.staleNowFiles.length === 0) {
    console.log(
      `No stale NOW files found (threshold: ${result.thresholdHours}h).`,
    )
    return
  }

  console.log(`Stale NOW files (>${result.thresholdHours}h):`)
  for (const stale of result.staleNowFiles) {
    const hours = Math.round(stale.ageHours * 10) / 10
    console.log(`- ${stale.filePath} (${hours}h old)`)
  }

  if (consolidate) {
    console.log(`Recovered ${result.recovered.length} session(s).`)
  } else {
    console.log('Run with --consolidate to recover these sessions.')
  }
}

async function handleAppend(kind: string, textParts: string[]): Promise<void> {
  const message = textParts.join(' ').trim()
  if (!message) {
    throw new Error('Missing message text.')
  }
  if (kind === 'user') {
    const exitCommand = parseExitCommand(message)
    if (exitCommand) {
      const path = await endSessionIfActive({
        consolidate: exitCommand.consolidate,
      })
      if (!path) {
        throw new Error('No active NOW session found.')
      }
      console.log(`Session ended: ${path}`)
      return
    }
    await appendUserMessage(message)
    console.log('Appended user message to NOW.')
    return
  }
  if (kind === 'agent') {
    await appendAgentMessage(message)
    console.log('Appended agent message to NOW.')
    return
  }
  if (kind === 'tool') {
    const toolName = textParts[0]
    if (!toolName) {
      throw new Error(
        'Missing tool name. Use: memory append tool <name> [summary]',
      )
    }
    const summary = textParts.slice(1).join(' ').trim() || undefined
    await appendToolCall(toolName, summary)
    console.log('Appended tool call to NOW.')
    return
  }
  throw new Error(`Unknown append kind: ${kind}`)
}

function parseExitCommand(message: string): { consolidate: boolean } | null {
  const trimmed = message.trim()
  if (trimmed === '/exit') {
    return { consolidate: false }
  }
  if (trimmed === '/exit --consolidate') {
    return { consolidate: true }
  }
  return null
}

function parseSearchTier(value: string): MemorySearchTier | 'all' {
  const normalized = value.toUpperCase()
  if (
    normalized === 'NOW' ||
    normalized === 'RECENT' ||
    normalized === 'MEMORY'
  ) {
    return normalized
  }
  if (normalized === 'ALL') {
    return 'all'
  }
  throw new Error('Invalid tier. Use: NOW, RECENT, MEMORY, or all.')
}

function parseSearchTags(value: string): string[] {
  const tags = value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
  if (tags.length === 0) {
    throw new Error(
      'Missing tags. Use: continuum memory search <query> --tags tag1,tag2',
    )
  }
  return tags
}

function parseRecallMode(value?: string): RecallSearchMode {
  if (!value) return 'auto'
  const normalized = value.toLowerCase()
  if (
    normalized === 'bm25' ||
    normalized === 'semantic' ||
    normalized === 'auto'
  ) {
    return normalized
  }
  throw new Error('Invalid mode. Use: bm25, semantic, or auto.')
}

function parseRecallLimit(value?: string): number {
  if (!value) return 5
  const count = Number(value)
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('Limit must be a positive integer.')
  }
  return count
}

function parseDiffLimit(value?: string): number {
  if (!value) return 10
  const count = Number(value)
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('Limit must be a positive integer.')
  }
  return count
}

function parseSyncLimit(value?: string): number | null {
  if (!value) return null
  const count = Number(value)
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('Limit must be a positive integer.')
  }
  return count
}

function parseProcessedVersion(value?: string): number {
  if (!value) return DEFAULT_SYNC_PROCESSED_VERSION
  const count = Number(value)
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('Processed version must be a positive integer.')
  }
  return count
}

function parseTail(value: string): number {
  const count = Number(value)
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('Tail count must be a positive integer.')
  }
  return count
}

function parseHours(value: string): number {
  const hours = Number(value)
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error('Hours must be a positive number.')
  }
  return hours
}

function parseLoopCount(value: string): number {
  const count = Number(value)
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('Count must be a positive integer.')
  }
  return count
}

function resolveDiffReportPath(dataRoot: string, value: string | null): string {
  if (value) {
    return resolve(process.cwd(), value)
  }
  return join(dataRoot, 'recall', 'opencode', 'diff-report.json')
}

function resolveSyncPlanPath(dataRoot: string, value: string | null): string {
  if (value) {
    return resolve(process.cwd(), value)
  }
  return join(dataRoot, 'recall', 'opencode', 'sync-plan.json')
}

function resolveSyncLedgerPath(dataRoot: string, value: string | null): string {
  if (value) {
    return resolve(process.cwd(), value)
  }
  return join(dataRoot, 'recall', 'opencode', 'state.json')
}

function resolveSyncLogPath(dataRoot: string, value: string | null): string {
  if (value) {
    return resolve(process.cwd(), value)
  }
  return join(dataRoot, 'recall', 'opencode', 'sync-log.jsonl')
}

function writeJsonFile(filePath: string, payload: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
}

function appendJsonLine(filePath: string, payload: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf-8')
}

function formatScore(score: number): string {
  const rounded = Math.round(score * 1000) / 1000
  return rounded.toFixed(3)
}

function formatRecallModeLabel(mode: 'bm25' | 'semantic'): string {
  if (mode === 'semantic') {
    return 'semantic (tf-idf)'
  }
  return mode
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return 'n/a'
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const rounded = Math.round(value * 10) / 10
  return `${rounded} ${units[unitIndex]}`
}

function formatAgeMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) {
    return 'n/a'
  }
  if (minutes < 60) {
    return `${minutes}m`
  }
  if (minutes < 60 * 24) {
    return `${Math.round(minutes / 60)}h`
  }
  return `${Math.round(minutes / (60 * 24))}d`
}
