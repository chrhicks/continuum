import { Command } from 'commander'
import { consolidateNow } from '../../../memory/consolidate'
import { listMemoryEntries } from '../../../memory/list'
import { readConsolidationLog } from '../../../memory/log'
import {
  appendAgentMessage,
  appendToolCall,
  appendUserMessage,
} from '../../../memory/now-writer'
import { recoverStaleNowFiles } from '../../../memory/recover'
import { searchMemory, type MemorySearchTier } from '../../../memory/search'
import { getStatus } from '../../../memory/status'
import { validateMemory } from '../../../memory/validate'
import {
  formatAgeMinutes,
  formatBytes,
  parseAfterDate,
  parseHours,
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
      const tags = options.tags ? parseSearchTags(options.tags) : []
      const afterDate = options.after ? parseAfterDate(options.after) : null
      handleSearch(query, tier, tags, afterDate)
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

function handleSearch(
  query: string,
  tier: MemorySearchTier | 'all',
  tags: string[],
  afterDate: Date | null,
): void {
  const result = searchMemory(query, tier, tags, afterDate ?? undefined)
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
