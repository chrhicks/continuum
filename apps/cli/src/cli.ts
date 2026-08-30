import { resolve } from 'node:path'
import type { Writable } from 'node:stream'
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

type SerializedOutput = {
  write(text: string): Promise<void>
  drain(): Promise<void>
}

export function createProgram(
  output: SerializedOutput = createSerializedOutput(process.stdout),
): Command {
  const program = new Command()
    .name('continuum')
    .description('Durable workspace memory for coding agents')
    .version('0.2.0')
    .addHelpCommand(false)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        void output.write(text)
      },
      writeErr: () => {},
    })

  program
    .command('guide')
    .description('Return version-matched Continuum usage guidance')
    .action(() => writeJson(output, getGuide()))

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
      return writeJson(output, result)
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
      return writeJson(output, result)
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
      return writeJson(output, result)
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
      return writeJson(output, result)
    })

  program
    .command('mcp')
    .description('Serve Continuum MCP over stdio')
    .action(() => serveContinuumMcp())

  return program
}

export async function runCli(argv: string[] = process.argv): Promise<number> {
  if (argv.length <= 2) {
    await writeCliError(
      new CliUsageError(
        'A command is required; use --help for available commands',
      ),
    )
    return 1
  }

  const output = createSerializedOutput(process.stdout)
  let commandFailed = false
  let commandFailure: unknown
  try {
    await createProgram(output).parseAsync(argv)
  } catch (cause) {
    commandFailed = true
    commandFailure = cause
  }

  let outputFailed = false
  let outputFailure: unknown
  try {
    await output.drain()
  } catch (cause) {
    outputFailed = true
    outputFailure = cause
  }

  if (outputFailed) {
    await writeCliError(outputFailure)
    return 1
  }
  if (
    commandFailed &&
    commandFailure instanceof CommanderError &&
    (commandFailure.code === 'commander.helpDisplayed' ||
      commandFailure.code === 'commander.version')
  ) {
    return 0
  }
  if (commandFailed) {
    await writeCliError(commandFailure)
    return 1
  }
  return 0
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

function writeJson(output: SerializedOutput, value: unknown): Promise<void> {
  return output.write(`${JSON.stringify(value)}\n`)
}

async function writeCliError(cause: unknown): Promise<void> {
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

  try {
    await writeFinite(
      process.stderr,
      `${JSON.stringify({
        error: {
          code: error.code,
          operation: error.operation,
          message: error.message,
          ...(error.context ? { context: error.context } : {}),
        },
      })}\n`,
    )
  } catch {
    // There is no remaining structured channel when stderr is unwritable.
  }
}

function createSerializedOutput(stream: Writable): SerializedOutput {
  let pending = Promise.resolve()

  return {
    write(text) {
      pending = pending.then(() => writeFinite(stream, text))
      // Commander output callbacks cannot await; attach a handler immediately.
      void pending.catch(() => {})
      return pending
    },
    drain() {
      return pending
    },
  }
}

function writeFinite(stream: Writable, text: string): Promise<void> {
  return new Promise((resolveWrite, rejectWrite) => {
    let settled = false
    let callbackFailure: Error | null | undefined

    const cleanup = () => stream.off('error', onError)
    const settle = (failed: boolean, cause?: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      if (failed) rejectWrite(cause)
      else resolveWrite()
    }
    const onError = (cause: Error) => settle(true, cause)
    const onWrite = (cause?: Error | null) => {
      if (!cause) {
        settle(false)
        return
      }

      callbackFailure = cause
      // Writable streams normally emit error after the write callback. Keep the
      // temporary listener through that turn, with a fallback for callback-only
      // implementations.
      setImmediate(() => settle(true, callbackFailure))
    }

    stream.once('error', onError)
    try {
      stream.write(text, onWrite)
    } catch (cause) {
      settle(true, cause)
    }
  })
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
