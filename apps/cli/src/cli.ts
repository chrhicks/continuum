import { resolve } from 'node:path'
import { Command, CommanderError } from 'commander'
import {
  ContinuumError,
  createContinuum,
  getGuide,
  type Continuum,
} from '@continuum/core'
import { serveContinuumMcp } from '@continuum/mcp'

type WorkspaceOptions = {
  cwd?: string
}

type SummaryOptions = WorkspaceOptions & {
  limit?: number
}

type RecordOptions = WorkspaceOptions & {
  content: string
  kind?: string
  tag: string[]
  supersedes: string[]
}

type SearchOptions = WorkspaceOptions & {
  query?: string
  tag: string[]
  kind: string[]
  includeHistory?: boolean
  limit?: number
  cursor?: string
}

export function createProgram(): Command {
  const program = new Command()
    .name('continuum')
    .description('Durable workspace memory for coding agents')
    .version('0.2.0')
    .addHelpCommand(false)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => process.stdout.write(text),
      writeErr: () => {},
    })

  program
    .command('guide')
    .description('Return version-matched Continuum usage guidance')
    .action(() => writeJson(getGuide()))

  program
    .command('summary')
    .description('Return the newest current records for a workspace')
    .option('--cwd <path>', 'Workspace path; defaults to the current directory')
    .option('--limit <number>', 'Maximum records to return', parseNumber)
    .action((options: SummaryOptions) => {
      const result = useContinuum((continuum) =>
        continuum.summary({
          workspace: workspacePath(options.cwd),
          limit: options.limit,
        }),
      )
      writeJson(result)
    })

  program
    .command('record')
    .description('Store one complete immutable memory record')
    .option('--cwd <path>', 'Workspace path; defaults to the current directory')
    .requiredOption(
      '--content <text>',
      'Complete self-contained memory content to preserve exactly',
    )
    .option('--kind <kind>', 'Open-ended memory kind; defaults to observation')
    .option(
      '--tag <tag>',
      'Tag to normalize and store; repeatable',
      collect,
      [],
    )
    .option(
      '--supersedes <id>',
      'Same-workspace record ID replaced by this record; repeatable',
      collect,
      [],
    )
    .action((options: RecordOptions) => {
      const result = useContinuum((continuum) =>
        continuum.record({
          workspace: workspacePath(options.cwd),
          content: options.content,
          kind: options.kind,
          tags: options.tag,
          supersedes: options.supersedes,
        }),
      )
      writeJson(result)
    })

  program
    .command('search')
    .description('Search memory or browse it chronologically')
    .option('--cwd <path>', 'Workspace path; defaults to the current directory')
    .option('--query <text>', 'Ordinary relevance-search text; omit to browse')
    .option('--tag <tag>', 'Required record tag; repeatable', collect, [])
    .option('--kind <kind>', 'Accepted record kind; repeatable', collect, [])
    .option('--include-history', 'Include records that have been superseded')
    .option('--limit <number>', 'Maximum records to return', parseNumber)
    .option('--cursor <cursor>', 'Opaque nextCursor from summary or search')
    .action((options: SearchOptions) => {
      const result = useContinuum((continuum) =>
        continuum.search({
          workspace: workspacePath(options.cwd),
          query: options.query,
          tags: options.tag,
          kinds: options.kind,
          includeHistory: options.includeHistory,
          limit: options.limit,
          cursor: options.cursor,
        }),
      )
      writeJson(result)
    })

  program
    .command('get')
    .description('Retrieve complete memory records by exact ID')
    .argument('<ids...>', 'One or more memory record IDs in caller order')
    .option('--cwd <path>', 'Workspace path; defaults to the current directory')
    .action((ids: string[], options: WorkspaceOptions) => {
      const result = useContinuum((continuum) =>
        continuum.get({
          workspace: workspacePath(options.cwd),
          ids,
        }),
      )
      writeJson(result)
    })

  program
    .command('mcp')
    .description('Serve Continuum MCP over stdio')
    .action(() => serveContinuumMcp())

  return program
}

export async function runCli(argv: string[] = process.argv): Promise<number> {
  if (argv.length <= 2) {
    writeCliError(
      new CliUsageError(
        'A command is required; use --help for available commands',
      ),
    )
    return 1
  }

  try {
    await createProgram().parseAsync(argv)
    return 0
  } catch (cause) {
    if (
      cause instanceof CommanderError &&
      (cause.code === 'commander.helpDisplayed' ||
        cause.code === 'commander.version')
    ) {
      return 0
    }
    writeCliError(cause)
    return 1
  }
}

function useContinuum<T>(operation: (continuum: Continuum) => T): T {
  const continuum = createContinuum()
  let result!: T
  let operationFailed = false
  let operationFailure: unknown

  try {
    result = operation(continuum)
  } catch (cause) {
    operationFailed = true
    operationFailure = cause
  }

  try {
    continuum.close()
  } catch (cause) {
    if (!operationFailed) throw cause
  }

  if (operationFailed) throw operationFailure
  return result
}

function workspacePath(cwd: string | undefined): string {
  return resolve(process.cwd(), cwd ?? '.')
}

function parseNumber(value: string): number {
  return Number(value)
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function writeCliError(cause: unknown): void {
  const error =
    cause instanceof ContinuumError
      ? {
          code: cause.code,
          operation: cause.operation,
          message: cause.message,
          context: safeContext(cause.context),
        }
      : {
          code: 'CLI_ERROR',
          operation: 'cli',
          message:
            cause instanceof CommanderError || cause instanceof CliUsageError
              ? cause.message
              : 'Continuum could not complete the CLI operation.',
          context: undefined,
        }

  process.stderr.write(
    `${JSON.stringify({
      error: {
        code: error.code,
        operation: error.operation,
        message: error.message,
        ...(error.context ? { context: error.context } : {}),
      },
    })}\n`,
  )
}

function safeContext(
  context: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!context) return undefined
  const safeKeys = new Set([
    'workspacePath',
    'recordId',
    'conflictingAlias',
    'databasePath',
    'dataDirectory',
  ])
  const safeEntries = Object.entries(context).filter(([key]) =>
    safeKeys.has(key),
  )
  return safeEntries.length > 0 ? Object.fromEntries(safeEntries) : undefined
}

class CliUsageError extends Error {}
