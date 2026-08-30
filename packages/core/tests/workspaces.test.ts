import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  ContinuumError,
  WorkspaceConflictError,
  createContinuum,
} from '@continuum/core'
import { normalizeGitRemote } from '../src/workspaces/git-workspace'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    if (process.platform !== 'win32') chmodSync(root, 0o700)
    rmSync(root, { recursive: true, force: true })
  }
})

describe('logical workspace identity', () => {
  test('rejects invalid workspace paths with a structured workspace error', () => {
    const root = temporaryRoot()
    const continuum = createContinuum({ dataDirectory: join(root, 'data') })

    expect(() => continuum.resolveWorkspace('relative/workspace')).toThrow(
      ContinuumError,
    )
    try {
      continuum.resolveWorkspace('relative/workspace')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'WORKSPACE_ERROR',
        operation: 'resolve workspace',
      })
    }
    expect(() => continuum.resolveWorkspace(join(root, 'missing'))).toThrow(
      ContinuumError,
    )
    continuum.close()
  })

  test('uses normalized paths for isolated non-Git workspaces', () => {
    const root = temporaryRoot()
    const firstPath = makeDirectory(root, 'first')
    const secondPath = makeDirectory(root, 'second')
    const dataDirectory = join(root, 'data')
    const continuum = createContinuum({ dataDirectory })

    const first = continuum.resolveWorkspace(firstPath)
    const second = continuum.resolveWorkspace(secondPath)
    continuum.close()

    expect(first.identity).toEqual({ kind: 'path', value: resolve(firstPath) })
    expect(second.identity).toEqual({
      kind: 'path',
      value: resolve(secondPath),
    })
    expect(first.identity).not.toEqual(second.identity)

    const database = new Database(join(dataDirectory, 'continuum.db'))
    expect(countRows(database, 'workspaces')).toBe(2)
    database.close()
  })

  test('normalizes common SSH and HTTPS forms to one remote identity', () => {
    expect(normalizeGitRemote('git@GitHub.com:Example/Continuum.git')).toBe(
      'github.com/Example/Continuum',
    )
    expect(
      normalizeGitRemote('ssh://git@github.com/Example/Continuum.git'),
    ).toBe('github.com/Example/Continuum')
    expect(normalizeGitRemote('https://github.com/Example/Continuum.git')).toBe(
      'github.com/Example/Continuum',
    )
  })

  test('prefers origin and records distinct additional remotes', () => {
    const root = temporaryRoot()
    const repo = makeGitRepository(root, 'repo')
    git(
      repo,
      'remote',
      'add',
      'upstream',
      'https://gitlab.com/team/upstream.git',
    )
    git(repo, 'remote', 'add', 'origin', 'git@github.com:team/project.git')
    const continuum = createContinuum({ dataDirectory: join(root, 'data') })

    const workspace = continuum.resolveWorkspace(repo)
    continuum.close()

    expect(workspace.identity).toEqual({
      kind: 'git',
      value: 'github.com/team/project',
    })
    expect(workspace.aliases).toEqual(
      expect.arrayContaining([
        { kind: 'git', value: 'github.com/team/project' },
        { kind: 'git', value: 'gitlab.com/team/upstream' },
        { kind: 'path', value: resolve(repo) },
      ]),
    )
  })

  test('shares one identity across clones and a Git worktree', () => {
    const root = temporaryRoot()
    const first = makeGitRepository(root, 'first')
    git(first, 'remote', 'add', 'origin', 'https://github.com/team/shared.git')
    writeFileSync(join(first, 'README.md'), 'shared\n')
    git(first, 'add', 'README.md')
    git(
      first,
      '-c',
      'user.name=Continuum Test',
      '-c',
      'user.email=continuum@example.test',
      'commit',
      '-m',
      'initial',
    )
    const linkedWorktree = join(root, 'linked-worktree')
    git(first, 'worktree', 'add', '-b', 'linked', linkedWorktree)

    const second = makeGitRepository(root, 'second')
    git(second, 'remote', 'add', 'origin', 'git@github.com:team/shared.git')

    const dataDirectory = join(root, 'data')
    const continuum = createContinuum({ dataDirectory })
    const firstWorkspace = continuum.resolveWorkspace(first)
    const secondWorkspace = continuum.resolveWorkspace(second)
    const linkedWorkspace = continuum.resolveWorkspace(linkedWorktree)
    continuum.close()

    expect(secondWorkspace.identity).toEqual(firstWorkspace.identity)
    expect(linkedWorkspace.identity).toEqual(firstWorkspace.identity)

    const database = new Database(join(dataDirectory, 'continuum.db'))
    expect(countRows(database, 'workspaces')).toBe(1)
    expect(countRows(database, 'workspace_aliases')).toBe(4)
    database.close()
  })

  test('keeps an existing path identity when Git remotes appear later', () => {
    const root = temporaryRoot()
    const workspacePath = makeDirectory(root, 'growing-project')
    const clonePath = makeGitRepository(root, 'fresh-clone')
    const dataDirectory = join(root, 'data')
    const continuum = createContinuum({ dataDirectory })

    const beforeGit = continuum.resolveWorkspace(workspacePath)
    git(workspacePath, 'init', '--quiet')
    git(
      workspacePath,
      'remote',
      'add',
      'origin',
      'https://github.com/team/growing.git',
    )
    git(clonePath, 'remote', 'add', 'origin', 'git@github.com:team/growing.git')

    const afterGit = continuum.resolveWorkspace(workspacePath)
    const freshClone = continuum.resolveWorkspace(clonePath)
    continuum.close()

    expect(beforeGit.identity).toEqual({
      kind: 'path',
      value: resolve(workspacePath),
    })
    expect(afterGit.identity).toEqual(beforeGit.identity)
    expect(freshClone.identity).toEqual(beforeGit.identity)
    expect(afterGit.aliases).toContainEqual({
      kind: 'git',
      value: 'github.com/team/growing',
    })
  })

  test('surfaces alias collisions without reassociating either workspace', () => {
    const root = temporaryRoot()
    const firstPath = makeDirectory(root, 'first')
    const secondPath = makeDirectory(root, 'second')
    const dataDirectory = join(root, 'data')
    const continuum = createContinuum({ dataDirectory })

    const firstBefore = continuum.resolveWorkspace(firstPath)
    const secondBefore = continuum.resolveWorkspace(secondPath)
    git(firstPath, 'init', '--quiet')
    git(secondPath, 'init', '--quiet')
    git(
      firstPath,
      'remote',
      'add',
      'origin',
      'https://github.com/team/first.git',
    )
    git(
      secondPath,
      'remote',
      'add',
      'origin',
      'https://github.com/team/second.git',
    )
    continuum.resolveWorkspace(firstPath)
    continuum.resolveWorkspace(secondPath)
    git(
      firstPath,
      'remote',
      'add',
      'conflict',
      'git@github.com:team/second.git',
    )

    expect(() => continuum.resolveWorkspace(firstPath)).toThrow(
      WorkspaceConflictError,
    )

    git(firstPath, 'remote', 'remove', 'conflict')
    const firstAfter = continuum.resolveWorkspace(firstPath)
    const secondAfter = continuum.resolveWorkspace(secondPath)
    continuum.close()

    expect(firstAfter.identity).toEqual(firstBefore.identity)
    expect(secondAfter.identity).toEqual(secondBefore.identity)

    const database = new Database(join(dataDirectory, 'continuum.db'))
    expect(countRows(database, 'workspaces')).toBe(2)
    expect(
      database
        .query(
          `SELECT workspace_id FROM workspace_aliases
           WHERE kind = 'git' AND value = 'github.com/team/second'`,
        )
        .get(),
    ).not.toBeNull()
    database.close()
  })
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'continuum-workspace-'))
  temporaryRoots.push(root)
  return root
}

function makeDirectory(root: string, name: string): string {
  const path = join(root, name)
  mkdirSync(path)
  return path
}

function makeGitRepository(root: string, name: string): string {
  const path = makeDirectory(root, name)
  git(path, 'init', '--quiet')
  return path
}

function git(cwd: string, ...args: string[]): void {
  const process = Bun.spawnSync(['git', '-C', cwd, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (process.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(process.stderr))
  }
}

function countRows(database: Database, table: string): number {
  return Number(
    (
      database.query(`SELECT COUNT(*) count FROM ${table}`).get() as {
        count: number
      }
    ).count,
  )
}
