import { readFile } from 'node:fs/promises'
import type { Command } from 'commander'
import { isContinuumError } from '../sdk'

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
  let root: Command = command
  while (root.parent) {
    root = root.parent
  }
  const options = root.opts<{ json?: boolean; quiet?: boolean; cwd?: string }>()
  return {
    json: Boolean(options.json),
    quiet: Boolean(options.quiet),
    cwd: options.cwd ?? process.cwd(),
  }
}

export async function readInput(value?: string): Promise<string | undefined> {
  if (value === undefined) return undefined
  if (value === '@-') {
    if (process.stdin.isTTY) {
      throw new Error(
        "No stdin detected for '@-'. Pipe input or use @file instead. Example: cat notes.md | continuum task note add tkt-123 --content @-",
      )
    }
    const stdin = await readStdin()
    if (!stdin) {
      throw new Error(
        "No stdin detected for '@-'. Pipe input or use @file instead. Example: cat notes.md | continuum task note add tkt-123 --content @-",
      )
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
        meta: { cwd: process.cwd(), durationMs: Date.now() - startedAt },
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
        meta: { cwd: process.cwd(), durationMs: Date.now() - startedAt },
      }
      console.log(JSON.stringify(payload, null, 2))
      process.exitCode = 1
      return
    }
    throw error
  }
}

function formatError(error: unknown): JsonError['error'] {
  if (isContinuumError(error)) {
    return {
      code: error.code,
      message: error.message,
      suggestions: error.suggestions,
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
