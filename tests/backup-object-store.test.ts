import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Effect, type Layer } from 'effect'
import {
  BackupObjectStore,
  type BackupObjectStoreService,
  wranglerObjectStoreLayer,
} from '../src/backup/object-store'
import {
  createFakeWrangler,
  FAKE_WRANGLER_TOKEN,
  fakeWranglerEnvironment,
  readFakeWranglerInvocation,
  type FakeWranglerMode,
} from './fake-wrangler'

const roots: string[] = []
const bucket = 'continuum-test-backups'

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('Wrangler R2 object store', () => {
  test('downloads through exact Wrangler argv and a controlled environment', async () => {
    const root = createRoot()
    const fake = createFakeWrangler(root)
    const object = new Uint8Array([0, 1, 2, 255])
    writeFileSync(fake.objectPath, object)
    const layer = createLayer(fake, 'success')

    const downloaded = await runWithStore(layer, (store) =>
      store.get('projects/test/head.json'),
    )
    const invocation = readFakeWranglerInvocation(fake)

    expect(downloaded).toEqual(object)
    expect(invocation.args).toEqual([
      'r2',
      'object',
      'get',
      `${bucket}/projects/test/head.json`,
      '--file',
      invocation.filePath,
      '--remote',
    ])
    expect(invocation.environment).toEqual({
      marker: 'controlled-test-environment',
      tokenPresent: 'true',
      ambient: 'unset',
    })
    expect(JSON.stringify(invocation)).not.toContain(FAKE_WRANGLER_TOKEN)
    expect(existsSync(dirname(invocation.filePath))).toBe(false)
  })

  test('uploads through exact Wrangler argv and removes the input file', async () => {
    const root = createRoot()
    const fake = createFakeWrangler(root)
    const content = new Uint8Array([10, 20, 30])
    const layer = createLayer(fake, 'success')

    await runWithStore(layer, (store) =>
      store.put(
        'projects/test/generation.sqlite',
        content,
        'application/x-sqlite3',
      ),
    )
    const invocation = readFakeWranglerInvocation(fake)

    expect(invocation.args).toEqual([
      'r2',
      'object',
      'put',
      `${bucket}/projects/test/generation.sqlite`,
      '--file',
      invocation.filePath,
      '--content-type',
      'application/x-sqlite3',
      '--remote',
    ])
    expect(invocation.filePath).toMatch(
      /\/continuum-r2-[^/]+\/upload-[0-9a-f-]{36}$/,
    )
    expect(readFileSync(join(fake.recordDirectory, 'upload'))).toEqual(content)
    expect(existsSync(dirname(invocation.filePath))).toBe(false)
  })

  test('distinguishes a missing object from remote process failures', async () => {
    const root = createRoot()
    const fake = createFakeWrangler(root)
    const key = 'projects/test/head.json'
    const missing = await runWithStore(createLayer(fake, 'missing'), (store) =>
      store.get(key),
    )
    expect(missing).toBeNull()
    expect(existsSync(dirname(readFakeWranglerInvocation(fake).filePath))).toBe(
      false,
    )

    const failures: Array<[FakeWranglerMode, string]> = [
      ['auth', 'Authentication failed'],
      ['network', 'Network request timed out'],
      ['failure', 'Unexpected wrangler process failure'],
    ]
    for (const [mode, message] of failures) {
      const result = runWithStore(createLayer(fake, mode), (store) =>
        store.get(key),
      )
      await expect(result).rejects.toMatchObject({
        code: 'BACKUP_REMOTE_ERROR',
        operation: 'download',
        key,
      })
      await expect(result).rejects.toThrow(message)
      const invocation = readFakeWranglerInvocation(fake)
      expect(existsSync(dirname(invocation.filePath))).toBe(false)
      expect(JSON.stringify(invocation)).not.toContain(FAKE_WRANGLER_TOKEN)
    }
  })

  test('removes upload input after a nonzero Wrangler exit', async () => {
    const root = createRoot()
    const fake = createFakeWrangler(root)
    const result = runWithStore(createLayer(fake, 'failure'), (store) =>
      store.put(
        'projects/test/generation.sqlite',
        new Uint8Array([1]),
        'binary',
      ),
    )

    await expect(result).rejects.toMatchObject({
      code: 'BACKUP_REMOTE_ERROR',
      operation: 'upload',
    })
    const invocation = readFakeWranglerInvocation(fake)
    expect(existsSync(dirname(invocation.filePath))).toBe(false)
  })

  test('removes the private directory after a process execution error', async () => {
    const root = createRoot()
    const previousTmpdir = process.env.TMPDIR
    process.env.TMPDIR = root
    try {
      const layer = wranglerObjectStoreLayer({
        bucket,
        executable: join(root, 'missing-wrangler'),
        environment: { PATH: '/usr/bin:/bin' },
      })
      await expect(
        runWithStore(layer, (store) => store.get('projects/test/head.json')),
      ).rejects.toMatchObject({ code: 'BACKUP_REMOTE_ERROR' })
      expect(readdirSync(root)).toEqual([])
    } finally {
      if (previousTmpdir === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = previousTmpdir
    }
  })
})

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'continuum-wrangler-test-'))
  roots.push(root)
  return root
}

function createLayer(
  fake: ReturnType<typeof createFakeWrangler>,
  mode: FakeWranglerMode,
): Layer.Layer<BackupObjectStore> {
  return wranglerObjectStoreLayer({
    bucket,
    executable: fake.executable,
    environment: fakeWranglerEnvironment(fake, mode),
  })
}

function runWithStore<A, E>(
  layer: Layer.Layer<BackupObjectStore>,
  operation: (store: BackupObjectStoreService) => Effect.Effect<A, E>,
): Promise<A> {
  const program = Effect.gen(function* () {
    const store = yield* BackupObjectStore
    return yield* operation(store)
  })
  return Effect.runPromise(program.pipe(Effect.provide(layer)))
}
