import { Command } from 'commander'
import { consolidateNow } from '../../../memory/consolidate'
import { listMemoryEntries } from '../../../memory/list'
import {
  appendAgentMessage,
  appendToolCall,
  appendUserMessage,
} from '../../../memory/now-writer'
import { getStatus } from '../../../memory/status'
import { handleCollect } from './collect-handler'
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
import {
  handleLog,
  handleRecover,
  handleValidate,
} from './maintenance-handlers'
import { registerMemorySubcommands } from './memory-subcommands'
import { handleSearch } from './search-handler'

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
      handleSearch({
        query,
        source,
        tier,
        tags,
        afterDate,
        mode,
        limit,
        summaryDir: options.summaryDir,
      })
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
