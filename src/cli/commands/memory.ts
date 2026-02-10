import { Command } from 'commander'
import { initMemory } from '../../memory/init'
import {
  getCurrentSessionPath,
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
import { validateMemory } from '../../memory/validate'
import { readConsolidationLog } from '../../memory/log'
import { recoverStaleNowFiles } from '../../memory/recover'
import { handleLoop } from './loop'

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
    .action((options: { consolidate?: boolean }) => {
      const path = endSession()
      console.log(`Session ended: ${path}`)
      if (options.consolidate) {
        const result = consolidateNow()
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

export function endSessionIfActive(options: {
  consolidate: boolean
}): string | null {
  if (!getCurrentSessionPath()) {
    return null
  }
  const path = endSession()
  if (options.consolidate) {
    const result = consolidateNow()
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

function handleConsolidate(dryRun: boolean): void {
  const result = consolidateNow({ dryRun })
  logConsolidationResult(result)
}

function logConsolidationResult(
  result: ReturnType<typeof consolidateNow>,
): void {
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
    console.log(
      'Note: Consolidation uses @decision/@discovery/@pattern markers from NOW.',
    )
    return
  }

  console.log('Consolidation complete:')
  console.log(`- RECENT: ${result.recentPath}`)
  console.log(`- MEMORY: ${result.memoryPath}`)
  console.log(`- INDEX: ${result.memoryIndexPath}`)
  console.log(`- LOG: ${result.logPath}`)
  console.log(
    'Note: Consolidation uses @decision/@discovery/@pattern markers from NOW.',
  )
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

function handleRecover(
  maxHours: number | undefined,
  consolidate: boolean,
): void {
  const result = recoverStaleNowFiles({ maxHours, consolidate })
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
      const path = endSessionIfActive({ consolidate: exitCommand.consolidate })
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
