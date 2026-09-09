import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseExpandOptions } from '../src/cli/commands/task/parse'

const roots: string[] = []
const projectRoot = join(import.meta.dir, '..')

const none = { parent: false, children: false, blockers: false }
const childrenOnly = { parent: false, children: true, blockers: false }

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('task get expansion parsing', () => {
  test('accepts supported values, combinations, and empty separators', () => {
    expect(parseExpandOptions()).toEqual(none)
    expect(parseExpandOptions('parent')).toEqual({
      parent: true,
      children: false,
      blockers: false,
    })
    expect(parseExpandOptions('children,blockers')).toEqual({
      parent: false,
      children: true,
      blockers: true,
    })
    expect(parseExpandOptions(' parent, ,children,blockers, ')).toEqual({
      parent: true,
      children: true,
      blockers: true,
    })
    expect(parseExpandOptions(' , ')).toEqual(none)
  })

  test('accepts all only as a standalone alias', () => {
    expect(parseExpandOptions('all')).toEqual({
      parent: true,
      children: true,
      blockers: true,
    })
    expect(() => parseExpandOptions('all,parent')).toThrow(
      "Invalid expand item 'all'. Use: parent, children, blockers, or standalone all.",
    )
    expect(() => parseExpandOptions('parent,all')).toThrow(
      "Invalid expand item 'all'. Use: parent, children, blockers, or standalone all.",
    )
  })

  test('preserves tree precedence after validating expansion input', () => {
    expect(parseExpandOptions(undefined, true)).toEqual(childrenOnly)
    expect(parseExpandOptions('parent,blockers', true)).toEqual(childrenOnly)
    expect(parseExpandOptions('all', true)).toEqual(childrenOnly)
    expect(() => parseExpandOptions('typo', true)).toThrow(
      "Invalid expand item 'typo'. Use: parent, children, blockers, or standalone all.",
    )
  })

  test('rejects unsupported non-empty tokens', () => {
    for (const value of ['typo', 'parent,typo', 'all,all']) {
      expect(() => parseExpandOptions(value)).toThrow('Invalid expand item')
    }
  })

  test('reports invalid expansion through the CLI with a non-zero exit', () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-task-expand-'))
    roots.push(root)
    expect(cli(root, ['init']).status).toBe(0)

    const result = cli(root, [
      'task',
      'get',
      'tkt-not-used',
      '--expand',
      'parent,typo',
    ])

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(
      "UNKNOWN_ERROR: Invalid expand item 'typo'. Use: parent, children, blockers, or standalone all.",
    )
  })
})

function cli(root: string, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    ['run', 'bin/continuum', '--cwd', root, ...args],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: join(root, 'home'),
        XDG_DATA_HOME: join(root, 'xdg-data'),
      },
    },
  )
}
