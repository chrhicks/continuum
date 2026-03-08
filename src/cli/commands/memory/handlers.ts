import { Command } from 'commander'
import { collectOpencodeRecords } from '../../../memory/collectors/opencode'
import { collectTaskRecords } from '../../../memory/collectors/task'
import { consolidateNow } from '../../../memory/consolidate'
import { consolidatePreparedInputs } from '../../../memory/consolidate'
import { prepareCollectedRecordConsolidationInput } from '../../../memory/consolidation/extract'
import { listMemoryEntries } from '../../../memory/list'
import { readConsolidationLog } from '../../../memory/log'
import {
  appendAgentMessage,
  appendToolCall,
  appendUserMessage,
} from '../../../memory/now-writer'
import { getWorkspaceContext, memoryPath } from '../../../memory/paths'
import { importOpencodeRecall } from '../../../memory/recall-import'
import { recoverStaleNowFiles } from '../../../memory/recover'
import { type MemorySearchTier } from '../../../memory/search'
import {
  searchRetrieval,
  type RetrievalSearchSource,
} from '../../../memory/retrieval/search'
import { createDbMemoryStateRepository } from '../../../memory/state/db-repository'
import { getStatus } from '../../../memory/status'
import { validateMemory } from '../../../memory/validate'
import { parseOptionalPositiveInteger } from '../shared'
import { parseRecallMode } from './recall-helpers'
import {
  formatAgeMinutes,
  formatBytes,
  parseAfterDate,
  parseHours,
  parseSearchLimit,
  parseSearchSource,
  parseSearchTags,
  parseSearchTier,
  parseTail,
} from './handlers-helpers'
import { registerMemorySubcommands } from './memory-subcommands'

type ConsolidationResult = Awaited<ReturnType<typeof consolidateNow>>

export type EndSessionIfActive = (options: {
  consolidate: boolean
}) => Promise<string | null>

export function registerMemoryHandlers(
  memoryCommand: Command,
  sessionCommand: Command,
  endSessionIfActive: EndSessionIfActive,
): void {
  registerMemorySubcommands(memoryCommand, sessionCommand, {
    onSessionAppend: (kind, textParts) =>
      handleAppend(kind, textParts, endSessionIfActive),
    onStatus: () => handleStatus(),
    onList: () => handleList(),
    onConsolidate: (options) => handleConsolidate(options.dryRun ?? false),
    onAppend: (kind, textParts) =>
      handleAppend(kind, textParts, endSessionIfActive),
    onSearch: (query, options) => {
      const tier = options.tier ? parseSearchTier(options.tier) : 'all'
      const source = options.source ? parseSearchSource(options.source) : 'all'
      const tags = options.tags ? parseSearchTags(options.tags) : []
      const afterDate = options.after ? parseAfterDate(options.after) : null
      const mode = parseRecallMode(options.mode)
      const limit = options.limit ? parseSearchLimit(options.limit) : undefined
      handleSearch(
        query,
        source,
        tier,
        tags,
        afterDate,
        mode,
        limit,
        options.summaryDir,
      )
    },
    onLog: (options) => {
      const tail = options.tail ? parseTail(options.tail) : undefined
      handleLog(tail)
    },
    onRecover: (options) => {
      const hours = options.hours ? parseHours(options.hours) : undefined
      return handleRecover(hours, options.consolidate ?? false)
    },
    onValidate: () => handleValidate(),
    onCollect: (options) => handleCollect(options),
  })
}

export function logConsolidationResult(result: ConsolidationResult): void {
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

async function handleCollect(options: {
  source?: string
  db?: string
  repo?: string
  out?: string
  project?: string
  session?: string
  task?: string
  status?: string
  limit?: string
  summarize?: boolean
  import?: boolean
  summaryModel?: string
  summaryApiUrl?: string
  summaryApiKey?: string
  summaryMaxTokens?: string
  summaryTimeoutMs?: string
  summaryMaxChars?: string
  summaryMaxLines?: string
  summaryMergeMaxEstTokens?: string
}): Promise<void> {
  const source = (options.source ?? 'opencode').trim().toLowerCase()
  if (source !== 'opencode' && source !== 'task') {
    throw new Error(`Unsupported collect source: ${source}`)
  }

  const workspace = getWorkspaceContext()
  const checkpointRepository = createDbMemoryStateRepository({
    dbPath: workspace.continuumDbPath,
    legacyFilePath: memoryPath('collect-state.json'),
  })

  if (source === 'task') {
    const result = await collectTaskRecords(
      {
        directory: workspace.workspaceRoot,
        taskId: options.task ?? null,
        statuses: parseTaskCollectStatuses(options.status),
        limit: parseOptionalPositiveInteger(
          options.limit,
          null,
          'Collect limit must be a positive integer.',
        ),
      },
      { stateRepository: checkpointRepository },
    )

    if (result.items.length > 0) {
      await consolidatePreparedInputs(
        result.items.map((item) =>
          prepareCollectedRecordConsolidationInput({
            record: item.record,
            sourcePath: `${workspace.continuumDbPath}#task:${item.task.id}`,
            sessionId: item.task.id,
            tags: item.record.references.tags,
            precomputedSummary: item.summary,
          }),
        ),
        { skipSourceCleanup: true },
      )
    }

    console.log('Memory collect:')
    console.log(`- Source: ${source}`)
    console.log(`- Workspace: ${result.directory}`)
    console.log(`- Tasks examined: ${result.tasksExamined}`)
    console.log(`- Task records emitted: ${result.records.length}`)
    console.log(`- Skipped unchanged: ${result.skippedUnchanged}`)
    if (result.checkpoint) {
      console.log(`- Checkpoint: ${result.checkpoint.key}`)
    }
    return
  }

  const result = await collectOpencodeRecords(
    {
      dbPath: options.db ?? null,
      repoPath: options.repo ?? null,
      outDir: options.out ?? null,
      projectId: options.project ?? null,
      sessionId: options.session ?? null,
      limit: parseOptionalPositiveInteger(
        options.limit,
        null,
        'Collect limit must be a positive integer.',
      ),
      summarize: options.summarize,
      summaryModel: options.summaryModel ?? null,
      summaryApiUrl: options.summaryApiUrl ?? null,
      summaryApiKey: options.summaryApiKey ?? null,
      summaryMaxTokens: parseOptionalPositiveInteger(
        options.summaryMaxTokens,
        null,
        'Summary max tokens must be a positive integer.',
      ),
      summaryTimeoutMs: parseOptionalPositiveInteger(
        options.summaryTimeoutMs,
        null,
        'Summary timeout must be a positive integer.',
      ),
      summaryMaxChars: parseOptionalPositiveInteger(
        options.summaryMaxChars,
        null,
        'Summary max chars must be a positive integer.',
      ),
      summaryMaxLines: parseOptionalPositiveInteger(
        options.summaryMaxLines,
        null,
        'Summary max lines must be a positive integer.',
      ),
      summaryMergeMaxEstTokens: parseOptionalPositiveInteger(
        options.summaryMergeMaxEstTokens,
        null,
        'Summary merge token budget must be a positive integer.',
      ),
    },
    { stateRepository: checkpointRepository },
  )

  let imported = null
  if (options.import) {
    if (result.artifacts.summaries.length === 0) {
      throw new Error(
        'No summary docs were generated. Run with summarization enabled before using --import.',
      )
    }
    imported = await importOpencodeRecall({
      summaryDir: result.outDir,
      projectId: options.project ?? undefined,
      sessionId: options.session ?? undefined,
    })
  }

  console.log('Memory collect:')
  console.log(`- Source: ${source}`)
  console.log(`- Project: ${result.projectId}`)
  console.log(`- Repo: ${result.repoPath}`)
  console.log(`- Output dir: ${result.outDir}`)
  console.log(`- Sessions processed: ${result.sessionsProcessed}`)
  console.log(`- Records emitted: ${result.records.length}`)
  console.log(`- Normalized docs: ${result.artifacts.normalized.length}`)
  console.log(`- Summary docs: ${result.artifacts.summaries.length}`)
  if (result.checkpoint) {
    console.log(`- Checkpoint: ${result.checkpoint.key}`)
  }
  if (imported) {
    console.log(`- Imported summaries: ${imported.imported}`)
  }
}

function parseTaskCollectStatuses(
  value?: string,
): Array<'open' | 'ready' | 'blocked' | 'completed' | 'cancelled'> | null {
  if (!value) {
    return null
  }
  const valid = new Set(['open', 'ready', 'blocked', 'completed', 'cancelled'])
  const statuses = value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)

  if (statuses.length === 0) {
    throw new Error('Task status filter must include at least one status.')
  }
  for (const status of statuses) {
    if (!valid.has(status)) {
      throw new Error(
        'Invalid task status filter. Use: open, ready, blocked, completed, cancelled.',
      )
    }
  }
  return statuses as Array<
    'open' | 'ready' | 'blocked' | 'completed' | 'cancelled'
  >
}

function handleSearch(
  query: string,
  source: RetrievalSearchSource,
  tier: MemorySearchTier | 'all',
  tags: string[],
  afterDate: Date | null,
  mode: 'bm25' | 'semantic' | 'auto',
  limit?: number,
  summaryDir?: string,
): void {
  const result = searchRetrieval({
    query,
    source,
    tier,
    tags,
    afterDate: afterDate ?? undefined,
    recallMode: mode,
    recallSummaryDir: summaryDir,
    limit,
  })
  if (result.filesSearched === 0) {
    console.log('No searchable memory or recall files found.')
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
  console.log(
    `- Sources: memory=${result.memoryFilesSearched}, recall=${result.recallFilesSearched}`,
  )
  if (result.recallMode) {
    const fallback = result.recallFallback ? ' (fallback)' : ''
    console.log(`- Recall mode: ${result.recallMode}${fallback}`)
  }
  for (const match of result.matches) {
    if (match.source === 'memory') {
      console.log(
        `- [memory/${match.tier}] ${match.filePath}:${match.lineNumber} ${match.lineText}`,
      )
      continue
    }
    const scoreLabel =
      match.score === null ? '' : ` score=${match.score.toFixed(3)}`
    const sessionLabel = match.sessionId ? ` [${match.sessionId}]` : ''
    const titleLabel = match.title ? ` (${match.title})` : ''
    const snippetLabel = match.snippet ? ` - ${match.snippet}` : ''
    console.log(
      `- [recall${scoreLabel}] ${match.filePath}${sessionLabel}${titleLabel}${snippetLabel}`,
    )
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

async function handleAppend(
  kind: string,
  textParts: string[],
  endSessionIfActive: EndSessionIfActive,
): Promise<void> {
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
