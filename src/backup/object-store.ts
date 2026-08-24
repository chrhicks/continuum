import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bytesDigest } from './contracts'

export type BackupObjectStore = {
  get(key: string): Uint8Array | null
  put(key: string, content: Uint8Array, contentType: string): void
}

export type WranglerObjectStoreOptions = {
  bucket: string
  executable?: string
  environment?: NodeJS.ProcessEnv
}

export class WranglerR2ObjectStore implements BackupObjectStore {
  readonly #bucket: string
  readonly #executable: string
  readonly #environment: NodeJS.ProcessEnv

  constructor(options: WranglerObjectStoreOptions) {
    this.#bucket = options.bucket
    this.#executable =
      options.executable ?? process.env.CONTINUUM_WRANGLER ?? 'wrangler'
    this.#environment = options.environment ?? process.env
  }

  get(key: string): Uint8Array | null {
    return withPrivateTempDirectory((directory) => {
      const output = join(directory, 'object')
      const result = this.#run([
        'r2',
        'object',
        'get',
        `${this.#bucket}/${key}`,
        '--file',
        output,
        '--remote',
      ])
      if (result.status === 0) return readFileSync(output)
      if (isMissingObject(result.stderr)) return null
      throw commandFailure('download', key, result)
    })
  }

  put(key: string, content: Uint8Array, contentType: string): void {
    withPrivateTempDirectory((directory) => {
      const input = join(directory, `upload-${randomUUID()}`)
      writeFileSync(input, content, { mode: 0o600, flag: 'wx' })
      const result = this.#run([
        'r2',
        'object',
        'put',
        `${this.#bucket}/${key}`,
        '--file',
        input,
        '--content-type',
        contentType,
        '--remote',
      ])
      if (result.status !== 0) throw commandFailure('upload', key, result)
    })
  }

  #run(args: string[]): CommandResult {
    const result = spawnSync(this.#executable, args, {
      encoding: 'utf8',
      env: this.#environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (result.error) {
      throw new Error(`Unable to run Wrangler: ${result.error.message}`)
    }
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    }
  }
}

export function putImmutable(
  store: BackupObjectStore,
  key: string,
  content: Uint8Array,
  contentType: string,
): void {
  const existing = store.get(key)
  if (existing) {
    if (bytesDigest(existing) !== bytesDigest(content)) {
      throw new Error(`Immutable R2 object conflict: ${key}`)
    }
    return
  }

  store.put(key, content, contentType)
  const uploaded = store.get(key)
  if (!uploaded || bytesDigest(uploaded) !== bytesDigest(content)) {
    throw new Error(`R2 upload verification failed: ${key}`)
  }
}

type CommandResult = {
  status: number | null
  stdout: string
  stderr: string
}

function withPrivateTempDirectory<T>(operation: (path: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'continuum-r2-'))
  chmodSync(directory, 0o700)
  try {
    return operation(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function isMissingObject(stderr: string): boolean {
  return /(?:404|not found|does not exist|NoSuchKey)/i.test(stderr)
}

function commandFailure(
  operation: string,
  key: string,
  result: CommandResult,
): Error {
  const detail = result.stderr.trim() || result.stdout.trim() || 'unknown error'
  return new Error(`R2 ${operation} failed for ${key}: ${detail}`)
}
