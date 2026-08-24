import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cliPath = join(import.meta.dir, '..', 'bin', 'continuum')
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('backup CLI errors', () => {
  test('renders missing configuration with a stable JSON code', () => {
    const workspace = createWorkspace()
    const result = runCli(workspace, ['backup', 'create'])

    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: 'BACKUP_CONFIGURATION_ERROR' },
    })
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
})

function createWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'continuum-backup-cli-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  mkdirSync(join(workspace, '.git'), { recursive: true })
  return workspace
}

function runCli(
  workspace: string,
  args: string[],
): ReturnType<typeof spawnSync> {
  return spawnSync(
    'bun',
    ['run', cliPath, '--json', '--cwd', workspace, ...args],
    { encoding: 'utf8', env: process.env },
  )
}
