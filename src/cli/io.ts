import { readFile } from 'node:fs/promises'
import type { Command } from 'commander'
import { isContinuumError } from '../sdk'
import { Effect, Result } from 'effect'
import { getWorkspaceContext } from '../memory/paths'
import {
  MemoryRuntime,
  memoryRuntimeLayer,
} from '../memory/runtime/memory-runtime'
import { getActiveWorkspaceContext } from '../workspace/context'
import { prepareCanonicalDatabase } from '../db/storage'
import { isCanonicalStorageError } from '../db/storage-errors'

export type GlobalCliOptions = {
  json: boolean
  quiet: boolean
  cwd: string
}

type JsonSuccess<T> = {
  ok: true
  data: T
  meta: { cwd: string; durationMs: number }
}

type JsonError = {
  ok: false
  error: { code: string; message: string; suggestions?: string[] }
  meta: { cwd: string; durationMs: number }
}

export function getGlobalOptions(command: Command): GlobalCliOptions {
  const activeWorkspace = getActiveWorkspaceContext()
  if (!command || typeof (command as Command).opts !== 'function') {
    return {
      json: false,
      quiet: false,
      cwd: activeWorkspace?.workspaceRoot ?? process.cwd(),
    }
  }

  let root: Command = command
  while (root.parent) {
    root = root.parent
  }
  if (typeof root.opts !== 'function') {
    return {
      json: false,
      quiet: false,
      cwd: activeWorkspace?.workspaceRoot ?? process.cwd(),
    }
  }

  const options = root.opts<{ json?: boolean; quiet?: boolean; cwd?: string }>()
  return {
    json: Boolean(options.json),
    quiet: Boolean(options.quiet),
    cwd: activeWorkspace?.workspaceRoot ?? options.cwd ?? process.cwd(),
  }
}

export async function readInput(value?: string): Promise<string | undefined> {
  if (value === undefined) return undefined
  if (value === '@-') {
    const stdinMessage = `No stdin detected for '@-'. Pipe input, use a heredoc, or use @file instead.
Example:
continuum task note add tkt-123 --content @- <<'EOF'
Your notes here
EOF`
    if (process.stdin.isTTY) {
      throw new Error(stdinMessage)
    }
    const stdin = await readStdin()
    if (!stdin) {
      throw new Error(stdinMessage)
    }
    return stdin
  }
  if (value.startsWith('@')) {
    const path = value.slice(1)
    if (!path) {
      throw new Error('Invalid input reference.')
    }
    return readFile(path, 'utf8')
  }
  return value
}

export async function readJsonInput<T = unknown>(
  value?: string,
): Promise<T | undefined> {
  const raw = await readInput(value)
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw.trim()) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid JSON input: ${message}`)
  }
}

export function parseIdList(value?: string | string[]): string[] | undefined {
  if (!value) return undefined
  const list = Array.isArray(value)
    ? value.flatMap((item) => item.split(','))
    : value.split(',')
  const trimmed = list.map((item) => item.trim()).filter(Boolean)
  return trimmed.length > 0 ? trimmed : undefined
}

export async function runCommand<T>(
  command: Command,
  executor: () => Promise<T>,
  render: (data: T) => void,
): Promise<void> {
  const options = getGlobalOptions(command)
  const startedAt = Date.now()
  try {
    const data = await executor()
    if (options.json) {
      const payload: JsonSuccess<T> = {
        ok: true,
        data,
        meta: { cwd: options.cwd, durationMs: Date.now() - startedAt },
      }
      console.log(JSON.stringify(payload, null, 2))
      return
    }
    if (!options.quiet) {
      render(data)
    }
  } catch (error) {
    if (options.json) {
      const payload: JsonError = {
        ok: false,
        error: formatError(error),
        meta: { cwd: options.cwd, durationMs: Date.now() - startedAt },
      }
      console.log(JSON.stringify(payload, null, 2))
      process.exitCode = 1
      return
    }
    const formatted = formatError(error)
    console.error(`${formatted.code}: ${formatted.message}`)
    process.exitCode = 1
  }
}

export async function runMemoryCommand<T, E>(
  command: Command,
  effect: Effect.Effect<T, E, MemoryRuntime>,
  render: (data: T) => void,
): Promise<void> {
  const context = getWorkspaceContext()
  const program = Effect.scoped(
    effect.pipe(
      Effect.provide(
        memoryRuntimeLayer({
          workspaceRoot: context.workspaceRoot,
          memoryDir: context.memoryDir,
          dbPath: context.continuumDbPath,
        }),
      ),
    ),
  )
  await runCommand(
    command,
    async () => {
      prepareCanonicalDatabase(context.workspaceRoot)
      const result = await Effect.runPromise(Effect.result(program))
      if (Result.isFailure(result)) throw result.failure
      return result.success
    },
    render,
  )
}

function formatError(error: unknown): JsonError['error'] {
  if (isContinuumError(error)) {
    return {
      code: error.code,
      message: error.message,
      suggestions: error.suggestions,
    }
  }
  if (isCanonicalStorageError(error)) {
    return { code: error.code, message: error.message }
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return { code: error.code, message: error.message }
  }
  if (typeof error === 'object' && error !== null && '_tag' in error) {
    const tagged = error as { _tag: string; cause?: unknown; path?: string }
    const cause = tagged.cause
    const detail = cause instanceof Error ? cause.message : String(cause ?? '')
    return {
      code: tagged._tag.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase(),
      message: [tagged._tag, tagged.path, detail].filter(Boolean).join(': '),
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { code: 'UNKNOWN_ERROR', message }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}
