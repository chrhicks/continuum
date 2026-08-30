import { Command, CommanderError } from 'commander'
import { getGuide } from '@continuum/core'
import { serveContinuumMcp } from '@continuum/mcp'

export function createProgram(): Command {
  const program = new Command()
    .name('continuum')
    .description('Durable workspace memory for coding agents')
    .version('0.2.0')
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
    .command('mcp')
    .description('Serve Continuum MCP over stdio')
    .action(() => serveContinuumMcp())

  return program
}

export async function runCli(argv: string[] = process.argv): Promise<number> {
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

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function writeCliError(cause: unknown): void {
  const message =
    cause instanceof CommanderError || cause instanceof Error
      ? cause.message
      : String(cause)
  process.stderr.write(
    `${JSON.stringify({
      error: {
        code: 'CLI_ERROR',
        operation: 'cli',
        message,
      },
    })}\n`,
  )
}
