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
import { Context, Effect, Layer } from 'effect'
import { bytesDigest } from './contracts'
import { BackupRemoteError, causeMessage } from './errors'

export interface BackupObjectStoreService {
  readonly get: (
    key: string,
  ) => Effect.Effect<Uint8Array | null, BackupRemoteError>
  readonly put: (
    key: string,
    content: Uint8Array,
    contentType: string,
  ) => Effect.Effect<void, BackupRemoteError>
}

export class BackupObjectStore extends Context.Service<
  BackupObjectStore,
  BackupObjectStoreService
>()('continuum/BackupObjectStore') {}

export type WranglerObjectStoreOptions = {
  bucket: string
  executable?: string
  environment?: NodeJS.ProcessEnv
}

export function wranglerObjectStoreLayer(
  options: WranglerObjectStoreOptions,
): Layer.Layer<BackupObjectStore> {
  return Layer.sync(BackupObjectStore, () => {
    const adapter = new WranglerR2Adapter(options)
    return BackupObjectStore.of({
      get: Effect.fn('BackupObjectStore.get')((key: string) =>
        adapter.get(key),
      ),
      put: Effect.fn('BackupObjectStore.put')(
        (key: string, content: Uint8Array, contentType: string) =>
          adapter.put(key, content, contentType),
      ),
    })
  })
}

export const putImmutable = Effect.fn('BackupObjectStore.putImmutable')(
  function* (key: string, content: Uint8Array, contentType: string) {
    const store = yield* BackupObjectStore
    const existing = yield* store.get(key)
    if (existing) {
      if (bytesDigest(existing) !== bytesDigest(content)) {
        return yield* Effect.fail(
          remoteError(
            'verify immutable object',
            key,
            `Immutable R2 object conflict: ${key}`,
          ),
        )
      }
      return
    }

    yield* store.put(key, content, contentType)
    const uploaded = yield* store.get(key)
    if (!uploaded || bytesDigest(uploaded) !== bytesDigest(content)) {
      return yield* Effect.fail(
        remoteError(
          'verify upload',
          key,
          `R2 upload verification failed: ${key}`,
        ),
      )
    }
  },
)

class WranglerR2Adapter {
  readonly #bucket: string
  readonly #executable: string
  readonly #environment: NodeJS.ProcessEnv

  constructor(options: WranglerObjectStoreOptions) {
    this.#bucket = options.bucket
    this.#executable =
      options.executable ?? process.env.CONTINUUM_WRANGLER ?? 'wrangler'
    this.#environment = options.environment ?? process.env
  }

  get(key: string): Effect.Effect<Uint8Array | null, BackupRemoteError> {
    return Effect.try({
      try: () =>
        withPrivateTempDirectory((directory) => {
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
        }),
      catch: (cause) =>
        remoteError(
          'download',
          key,
          `R2 download failed: ${causeMessage(cause)}`,
          cause,
        ),
    })
  }

  put(
    key: string,
    content: Uint8Array,
    contentType: string,
  ): Effect.Effect<void, BackupRemoteError> {
    return Effect.try({
      try: () =>
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
        }),
      catch: (cause) =>
        remoteError(
          'upload',
          key,
          `R2 upload failed: ${causeMessage(cause)}`,
          cause,
        ),
    })
  }

  #run(args: string[]): CommandResult {
    const result = spawnSync(this.#executable, args, {
      encoding: 'utf8',
      env: this.#environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (result.error) throw result.error
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    }
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

function remoteError(
  operation: string,
  key: string,
  message: string,
  cause?: unknown,
): BackupRemoteError {
  return new BackupRemoteError({
    code: 'BACKUP_REMOTE_ERROR',
    operation,
    key,
    message,
    ...(cause === undefined ? {} : { cause }),
  })
}
