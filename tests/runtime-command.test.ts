import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { canonicalDbFilePath } from '../src/db/paths'

const repoRoot = process.cwd()
const cliPath = realpathSync(join(repoRoot, 'bin', 'continuum'))
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('runtime command', () => {
  test('reports the exact CLI, workspace, and XDG database without writing', () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-runtime-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const home = join(root, 'home')
    const dataHome = join(root, 'xdg-data')
    mkdirSync(join(workspace, '.git'), { recursive: true })
    mkdirSync(home, { recursive: true })

    const result = spawnSync(
      'bun',
      ['run', cliPath, '--cwd', workspace, '--json', 'runtime'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, HOME: home, XDG_DATA_HOME: dataHome },
      },
    )

    expect(result.status).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload.data).toEqual({
      storageGeneration: 'xdg-project-sha256-v1',
      workspace,
      entrypoint: cliPath,
      home,
      dataHome,
      database: canonicalDbFilePath(workspace, { dataHome }),
    })
    expect(existsSync(payload.data.database)).toBe(false)
    expect(existsSync(join(workspace, '.continuum'))).toBe(false)
  })
})
