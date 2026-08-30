import type { Writable } from 'node:stream'
import { ContinuumError } from '@continuum/core'
import { importV1, type ImportV1Options } from './import-v1'

export async function runImportV1Cli(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  let result: ReturnType<typeof importV1>
  try {
    result = importV1(parseArguments(argv))
  } catch (cause) {
    await writeImportError(cause)
    return 1
  }

  try {
    await writeFinite(process.stdout, `${JSON.stringify(result)}\n`)
    return 0
  } catch {
    await writeImportError(undefined)
    return 1
  }
}

function parseArguments(argv: string[]): ImportV1Options {
  const values = new Map<string, string>()
  const supported = new Map([
    ['--source', 'source'],
    ['--workspace', 'workspace'],
    ['--data-dir', 'dataDirectory'],
  ])

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] as string
    const field = supported.get(flag)
    if (!field) throw usageError('Legacy import received an unknown argument.')
    if (values.has(field)) {
      throw usageError('Legacy import flags may only be supplied once.', field)
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw usageError('A legacy import flag is missing its value.', field)
    }
    values.set(field, value)
    index += 1
  }

  const source = values.get('source')
  const workspace = values.get('workspace')
  if (source === undefined || workspace === undefined) {
    throw usageError(
      'Legacy import requires --source and --workspace.',
      source === undefined ? 'source' : 'workspace',
    )
  }

  return {
    source,
    workspace,
    ...(values.has('dataDirectory')
      ? { dataDirectory: values.get('dataDirectory') }
      : {}),
  }
}

async function writeImportError(cause: unknown): Promise<void> {
  const error =
    cause instanceof ContinuumError
      ? {
          code: cause.code,
          operation: cause.operation,
          message: cause.message,
          context: safeContext(cause.context),
        }
      : {
          code: 'DATABASE_ERROR',
          operation: 'import v1',
          message: 'Legacy import could not be completed.',
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
    // There is no structured output channel when stderr is unwritable.
  }
}

function usageError(message: string, field?: string): ContinuumError {
  return new ContinuumError({
    code: 'VALIDATION_ERROR',
    operation: 'import v1',
    message,
    context: field ? { field } : undefined,
  })
}

function safeContext(
  context: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!context) return undefined
  const safeKeys = new Set([
    'sourcePath',
    'field',
    'sequence',
    'workspacePath',
    'recordId',
    'conflictingAlias',
    'databasePath',
    'dataDirectory',
  ])
  const entries = Object.entries(context).filter(([key]) => safeKeys.has(key))
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function writeFinite(stream: Writable, text: string): Promise<void> {
  return new Promise((resolveWrite, rejectWrite) => {
    let settled = false
    let callbackFailure: Error | null | undefined
    const cleanup = () => stream.off('error', onError)
    const settle = (cause?: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      if (cause) rejectWrite(cause)
      else resolveWrite()
    }
    const onError = (cause: Error) => settle(cause)
    const onWrite = (cause?: Error | null) => {
      if (!cause) {
        settle()
        return
      }
      callbackFailure = cause
      setImmediate(() => settle(callbackFailure))
    }

    stream.once('error', onError)
    try {
      stream.write(text, onWrite)
    } catch (cause) {
      settle(cause)
    }
  })
}
