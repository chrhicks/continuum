import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  createFakeWrangler,
  FAKE_WRANGLER_TOKEN,
  fakeWranglerEnvironment,
  readFakeWranglerInvocation,
  type FakeWrangler,
  type FakeWranglerMode,
} from './fake-wrangler'

const cliPath = join(import.meta.dir, '..', 'bin', 'continuum')
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
  rmSync(backupCreationLockPath(), { force: true })
})

describe('backup CLI boundaries', () => {
  test('renders missing configuration in JSON and human modes', () => {
    const workspace = createWorkspace()
    const jsonResult = runCli(workspace, ['backup', 'create'])

    expect(jsonResult.status).toBe(1)
    expect(JSON.parse(jsonResult.stdout)).toMatchObject({
      ok: false,
      error: { code: 'BACKUP_CONFIGURATION_ERROR' },
    })

    const humanResult = runCli(workspace, ['backup', 'create'], {
      json: false,
    })
    expect(humanResult.status).toBe(1)
    expect(humanResult.stdout).toBe('')
    expect(humanResult.stderr).toContain(
      'BACKUP_CONFIGURATION_ERROR: R2 backup is not configured.',
    )
  })

  test('renders malformed backup contracts with a stable JSON code', () => {
    const workspace = createWorkspace()
    const configDir = join(workspace, '.continuum')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      join(configDir, 'r2-backup.json'),
      '{"formatVersion":2}\n',
      'utf8',
    )

    const result = runCli(workspace, ['backup', 'list'])
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: 'BACKUP_DECODE_ERROR' },
    })
  })

  test('renders local creation contention with a stable code', () => {
    const workspace = createWorkspace()
    configureWorkspace(workspace)
    writeActiveBackupLock()

    const jsonResult = runCli(workspace, ['backup', 'create'])
    expect(jsonResult.status).toBe(1)
    expect(JSON.parse(jsonResult.stdout)).toMatchObject({
      ok: false,
      error: { code: 'BACKUP_CREATION_CONFLICT' },
    })

    const humanResult = runCli(workspace, ['backup', 'create'], {
      json: false,
    })
    expect(humanResult.status).toBe(1)
    expect(humanResult.stderr).toContain('BACKUP_CREATION_CONFLICT:')
  })

  test('lists an empty remote through human and JSON output', () => {
    const workspace = createWorkspace()
    configureWorkspace(workspace)
    const fake = createFakeWrangler(dirname(workspace))
    const args = ['backup', 'list', '--wrangler', fake.executable]
    const environment = cliEnvironment(fake, 'missing')

    const humanResult = runCli(workspace, args, { json: false, environment })
    expect(humanResult.status).toBe(0)
    expect(humanResult.stdout).toBe('No R2 backups found.\n')
    expect(humanResult.stderr).toBe('')

    const jsonResult = runCli(workspace, args, { environment })
    expect(jsonResult.status).toBe(0)
    expect(JSON.parse(jsonResult.stdout)).toMatchObject({ ok: true, data: [] })
    const invocation = readFakeWranglerInvocation(fake)
    expect(existsSync(dirname(invocation.filePath))).toBe(false)
    expect(`${humanResult.stdout}${jsonResult.stdout}`).not.toContain(
      FAKE_WRANGLER_TOKEN,
    )
  })

  test('renders stable missing and remote-error status outcomes', () => {
    const workspace = createWorkspace()
    configureWorkspace(workspace)
    const fake = createFakeWrangler(dirname(workspace))
    const args = ['backup', 'status', '--wrangler', fake.executable]

    const humanResult = runCli(workspace, args, {
      json: false,
      environment: { ...process.env, ...cliEnvironment(fake, 'missing') },
    })
    expect(humanResult.status).toBe(0)
    expect(humanResult.stdout).toContain('R2 backup status: missing\n')
    expect(humanResult.stdout).toContain('Freshness threshold: 86400 seconds\n')
    expect(humanResult.stdout).toContain('Remote: no backup head\n')

    const jsonResult = runCli(workspace, args, {
      environment: { ...process.env, ...cliEnvironment(fake, 'missing') },
    })
    expect(jsonResult.status).toBe(0)
    expect(JSON.parse(jsonResult.stdout)).toMatchObject({
      ok: true,
      data: {
        state: 'missing',
        staleAfterSeconds: 86_400,
        local: { digest: expect.stringMatching(/^[0-9a-f]{64}$/) },
        remote: null,
        errorCode: null,
      },
    })

    const errorResult = runCli(workspace, args, {
      environment: { ...process.env, ...cliEnvironment(fake, 'auth') },
    })
    expect(errorResult.status).toBe(0)
    expect(JSON.parse(errorResult.stdout)).toMatchObject({
      ok: true,
      data: {
        state: 'remote-error',
        remote: null,
        errorCode: 'BACKUP_REMOTE_ERROR',
      },
    })
    expect(
      `${humanResult.stdout}${jsonResult.stdout}${errorResult.stdout}`,
    ).not.toContain(FAKE_WRANGLER_TOKEN)
  })

  test('exposes stable remote error codes without disclosing tokens', () => {
    const workspace = createWorkspace()
    configureWorkspace(workspace)
    const fake = createFakeWrangler(dirname(workspace))
    const args = ['backup', 'list', '--wrangler', fake.executable]
    const environment = cliEnvironment(fake, 'auth')

    const jsonResult = runCli(workspace, args, { environment })
    expect(jsonResult.status).toBe(1)
    expect(JSON.parse(jsonResult.stdout)).toMatchObject({
      ok: false,
      error: {
        code: 'BACKUP_REMOTE_ERROR',
        message: expect.stringContaining('Authentication failed'),
      },
    })

    const humanResult = runCli(workspace, args, { json: false, environment })
    expect(humanResult.status).toBe(1)
    expect(humanResult.stderr).toContain(
      'BACKUP_REMOTE_ERROR: R2 download failed:',
    )
    expect(humanResult.stderr).toContain('Authentication failed')
    expect(
      `${jsonResult.stdout}${jsonResult.stderr}${humanResult.stdout}${humanResult.stderr}`,
    ).not.toContain(FAKE_WRANGLER_TOKEN)
  })
})

function createWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'continuum-backup-cli-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  mkdirSync(join(workspace, '.git'), { recursive: true })
  return workspace
}

type CliOptions = {
  json?: boolean
  environment?: NodeJS.ProcessEnv
}

function runCli(
  workspace: string,
  args: string[],
  options: CliOptions = {},
): ReturnType<typeof spawnSync> {
  const globalArgs = options.json === false ? [] : ['--json']
  return spawnSync(
    process.execPath,
    ['run', cliPath, ...globalArgs, '--cwd', workspace, ...args],
    { encoding: 'utf8', env: options.environment ?? process.env },
  )
}

function configureWorkspace(workspace: string): void {
  const initialized = runCli(workspace, ['init'])
  expect(initialized.status).toBe(0)
  const result = runCli(workspace, [
    'backup',
    'configure',
    '--bucket',
    'continuum-test-backups',
    '--project-id',
    '11111111-1111-4111-8111-111111111111',
    '--writer-id',
    '22222222-2222-4222-8222-222222222222',
  ])
  expect(result.status).toBe(0)
}

function backupCreationLockPath(): string {
  const dataHome = process.env.XDG_DATA_HOME
  if (!dataHome) throw new Error('test XDG_DATA_HOME is missing')
  return join(
    dataHome,
    'continuum',
    'backup-locks',
    '11111111-1111-4111-8111-111111111111.lock',
  )
}

function writeActiveBackupLock(): void {
  const path = backupCreationLockPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    `${JSON.stringify({
      version: 1,
      token: 'active-cli-test-holder',
      pid: process.pid,
      hostname: hostname(),
      createdAt: '2026-01-01T00:00:00.000Z',
    })}\n`,
    { mode: 0o600, flag: 'wx' },
  )
}

function cliEnvironment(
  fake: FakeWrangler,
  mode: FakeWranglerMode,
): NodeJS.ProcessEnv {
  return fakeWranglerEnvironment(fake, mode)
}
