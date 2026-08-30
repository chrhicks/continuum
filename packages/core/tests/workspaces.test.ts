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
import { pathToFileURL } from 'node:url'
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

  test('uses path fallback independently of the caller locale', () => {
    const root = temporaryRoot()
    const workspacePath = makeDirectory(root, 'localized-non-git')
    const continuum = createContinuum({ dataDirectory: join(root, 'data') })
    const previousLocale = process.env.LC_ALL
    process.env.LC_ALL = 'continuum_invalid_locale'

    try {
      expect(continuum.resolveWorkspace(workspacePath).identity).toEqual({
        kind: 'path',
        value: resolve(workspacePath),
      })
    } finally {
      if (previousLocale === undefined) delete process.env.LC_ALL
      else process.env.LC_ALL = previousLocale
      continuum.close()
    }
  })

  test('normalizes equivalent network and local remote forms without collapsing endpoints', () => {
    expect(normalizeGitRemote('git@GitHub.com:Example/Continuum.git')).toBe(
      'github.com/Example/Continuum',
    )
    expect(
      normalizeGitRemote('ssh://git@github.com/Example/Continuum.git'),
    ).toBe('github.com/Example/Continuum')
    expect(
      normalizeGitRemote('ssh://git@github.com:22/Example/Continuum.git'),
    ).toBe('github.com/Example/Continuum')
    expect(normalizeGitRemote('https://github.com/Example/Continuum.git')).toBe(
      'github.com/Example/Continuum',
    )
    expect(
      normalizeGitRemote('ssh://git@example.test:2222/team/project.git'),
    ).toBe('example.test:2222/team/project')
    expect(
      normalizeGitRemote('ssh://git@example.test:3333/team/project.git'),
    ).toBe('example.test:3333/team/project')

    const root = temporaryRoot()
    const plainPath = join(root, 'project')
    const dotGitPath = join(root, 'project.git')
    expect(normalizeGitRemote(plainPath)).toBe(`file:${plainPath}`)
    expect(normalizeGitRemote(pathToFileURL(plainPath).href)).toBe(
      `file:${plainPath}`,
    )
    expect(normalizeGitRemote(dotGitPath)).toBe(`file:${dotGitPath}`)
    expect(normalizeGitRemote(dotGitPath)).not.toBe(
      normalizeGitRemote(plainPath),
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

  test('keeps repositories on distinct explicit ports isolated', () => {
    const root = temporaryRoot()
    const first = makeGitRepository(root, 'first-port')
    const second = makeGitRepository(root, 'second-port')
    git(
      first,
      'remote',
      'add',
      'origin',
      'ssh://git@example.test:2222/team/project.git',
    )
    git(
      second,
      'remote',
      'add',
      'origin',
      'ssh://git@example.test:3333/team/project.git',
    )
    const dataDirectory = join(root, 'data')
    const continuum = createContinuum({ dataDirectory })

    const firstWorkspace = continuum.resolveWorkspace(first)
    const secondWorkspace = continuum.resolveWorkspace(second)
    continuum.close()

    expect(firstWorkspace.identity.value).toBe('example.test:2222/team/project')
    expect(secondWorkspace.identity.value).toBe(
      'example.test:3333/team/project',
    )
    const database = new Database(join(dataDirectory, 'continuum.db'))
    expect(countRows(database, 'workspaces')).toBe(2)
    database.close()
  })

  test('rejects an unowned origin when a shared secondary remote is owned', () => {
    const root = temporaryRoot()
    const first = makeGitRepository(root, 'first-fork')
    const second = makeGitRepository(root, 'second-fork')
    git(
      first,
      'remote',
      'add',
      'origin',
      'https://github.com/team/first-fork.git',
    )
    git(
      second,
      'remote',
      'add',
      'origin',
      'https://github.com/team/second-fork.git',
    )
    for (const path of [first, second]) {
      git(
        path,
        'remote',
        'add',
        'upstream',
        'https://github.com/team/upstream.git',
      )
    }
    const dataDirectory = join(root, 'data')
    const continuum = createContinuum({ dataDirectory })

    continuum.resolveWorkspace(first)
    expect(() => continuum.resolveWorkspace(second)).toThrow(
      WorkspaceConflictError,
    )

    const afterConflict = new Database(join(dataDirectory, 'continuum.db'))
    expect(countRows(afterConflict, 'workspaces')).toBe(1)
    expect(
      afterConflict
        .query(
          `SELECT workspace_id FROM workspace_aliases
           WHERE kind = 'git' AND value = 'github.com/team/second-fork'`,
        )
        .get(),
    ).toBeNull()
    afterConflict.close()

    git(second, 'remote', 'remove', 'upstream')
    const secondWorkspace = continuum.resolveWorkspace(second)
    continuum.close()

    expect(secondWorkspace.identity.value).toBe('github.com/team/second-fork')
    const database = new Database(join(dataDirectory, 'continuum.db'))
    expect(countRows(database, 'workspaces')).toBe(2)
    database.close()
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

  test('keeps a registered child path when its parent later becomes a Git root', () => {
    const root = temporaryRoot()
    const parentPath = makeDirectory(root, 'parent')
    const childPath = makeDirectory(parentPath, 'child')
    const clonePath = makeGitRepository(root, 'parent-clone')
    const dataDirectory = join(root, 'data')
    const continuum = createContinuum({ dataDirectory })

    const beforeGit = continuum.resolveWorkspace(childPath)
    git(parentPath, 'init', '--quiet')
    git(
      parentPath,
      'remote',
      'add',
      'origin',
      'https://github.com/team/parent-project.git',
    )
    git(
      clonePath,
      'remote',
      'add',
      'origin',
      'git@github.com:team/parent-project.git',
    )

    const afterGit = continuum.resolveWorkspace(childPath)
    const clone = continuum.resolveWorkspace(clonePath)
    continuum.close()

    expect(afterGit.identity).toEqual(beforeGit.identity)
    expect(clone.identity).toEqual(beforeGit.identity)
    expect(afterGit.aliases).toEqual(
      expect.arrayContaining([
        { kind: 'path', value: resolve(childPath) },
        { kind: 'path', value: resolve(parentPath) },
        { kind: 'git', value: 'github.com/team/parent-project' },
      ]),
    )

    const database = new Database(join(dataDirectory, 'continuum.db'))
    expect(countRows(database, 'workspaces')).toBe(1)
    database.close()
  })

  test('adopts a registered child when an unregistered sibling resolves first', () => {
    const root = temporaryRoot()
    const parentPath = makeDirectory(root, 'sibling-parent')
    const registeredChild = makeDirectory(parentPath, 'registered')
    const newSibling = makeDirectory(parentPath, 'new-sibling')
    const dataDirectory = join(root, 'data')
    const continuum = createContinuum({ dataDirectory })

    const beforeGit = continuum.resolveWorkspace(registeredChild)
    git(parentPath, 'init', '--quiet')
    git(
      parentPath,
      'remote',
      'add',
      'origin',
      'https://github.com/team/sibling-parent.git',
    )

    const sibling = continuum.resolveWorkspace(newSibling)
    const registered = continuum.resolveWorkspace(registeredChild)
    continuum.close()

    expect(sibling.identity).toEqual(beforeGit.identity)
    expect(registered.identity).toEqual(beforeGit.identity)
    expect(sibling.aliases).toEqual(
      expect.arrayContaining([
        { kind: 'path', value: resolve(registeredChild) },
        { kind: 'path', value: resolve(newSibling) },
        { kind: 'path', value: resolve(parentPath) },
        { kind: 'git', value: 'github.com/team/sibling-parent' },
      ]),
    )

    const database = new Database(join(dataDirectory, 'continuum.db'))
    expect(countRows(database, 'workspaces')).toBe(1)
    database.close()
  })

  test('rejects a new Git root containing path aliases from multiple workspaces', () => {
    const root = temporaryRoot()
    const parentPath = makeDirectory(root, 'conflicting-parent')
    const firstChild = makeDirectory(parentPath, 'first')
    const secondChild = makeDirectory(parentPath, 'second')
    const unregisteredSibling = makeDirectory(parentPath, 'third')
    const dataDirectory = join(root, 'data')
    const continuum = createContinuum({ dataDirectory })

    continuum.resolveWorkspace(firstChild)
    continuum.resolveWorkspace(secondChild)
    git(parentPath, 'init', '--quiet')
    git(
      parentPath,
      'remote',
      'add',
      'origin',
      'https://github.com/team/conflicting-parent.git',
    )

    expect(() => continuum.resolveWorkspace(unregisteredSibling)).toThrow(
      WorkspaceConflictError,
    )
    continuum.close()

    const database = new Database(join(dataDirectory, 'continuum.db'))
    expect(countRows(database, 'workspaces')).toBe(2)
    expect(
      database
        .query(
          `SELECT workspace_id FROM workspace_aliases
           WHERE kind = 'path' AND value IN (?, ?)`,
        )
        .all(resolve(parentPath), resolve(unregisteredSibling)),
    ).toEqual([])
    expect(
      database
        .query(
          `SELECT workspace_id FROM workspace_aliases
           WHERE kind = 'git' AND value = ?`,
        )
        .get('github.com/team/conflicting-parent'),
    ).toBeNull()
    database.close()
  })

  for (const requestedChild of ['first', 'second'] as const) {
    test(`rejects multiple descendant owners when the registered ${requestedChild} child resolves first`, () => {
      const root = temporaryRoot()
      const parentPath = makeDirectory(root, `direct-${requestedChild}-parent`)
      const firstChild = makeDirectory(parentPath, 'first')
      const secondChild = makeDirectory(parentPath, 'second')
      const dataDirectory = join(root, 'data')
      const continuum = createContinuum({ dataDirectory })

      const firstBefore = continuum.resolveWorkspace(firstChild)
      const secondBefore = continuum.resolveWorkspace(secondChild)
      git(parentPath, 'init', '--quiet')
      git(
        parentPath,
        'remote',
        'add',
        'origin',
        'https://github.com/team/direct-conflict.git',
      )

      const pathToResolve =
        requestedChild === 'first' ? firstChild : secondChild
      expect(() => continuum.resolveWorkspace(pathToResolve)).toThrow(
        WorkspaceConflictError,
      )
      continuum.close()

      const database = new Database(join(dataDirectory, 'continuum.db'))
      expect(countRows(database, 'workspaces')).toBe(2)
      expect(
        database
          .query(
            `SELECT kind, value FROM workspace_aliases
             ORDER BY kind, value`,
          )
          .all(),
      ).toEqual([
        { kind: 'path', value: resolve(firstChild) },
        { kind: 'path', value: resolve(secondChild) },
      ])
      expect(firstBefore.identity).not.toEqual(secondBefore.identity)
      expect(
        database
          .query(
            `SELECT workspace_id FROM workspace_aliases
             WHERE kind = 'git' AND value = ?`,
          )
          .get('github.com/team/direct-conflict'),
      ).toBeNull()
      database.close()
    })
  }

  test('rejects a registered Git root with a different descendant owner', () => {
    const root = temporaryRoot()
    const parentPath = makeDirectory(root, 'owned-root-parent')
    const childPath = makeDirectory(parentPath, 'child')
    const dataDirectory = join(root, 'data')
    const continuum = createContinuum({ dataDirectory })

    const parentBefore = continuum.resolveWorkspace(parentPath)
    const childBefore = continuum.resolveWorkspace(childPath)
    git(parentPath, 'init', '--quiet')
    git(
      parentPath,
      'remote',
      'add',
      'origin',
      'https://github.com/team/owned-root-conflict.git',
    )

    expect(() => continuum.resolveWorkspace(parentPath)).toThrow(
      WorkspaceConflictError,
    )
    continuum.close()

    const database = new Database(join(dataDirectory, 'continuum.db'))
    expect(countRows(database, 'workspaces')).toBe(2)
    expect(parentBefore.identity).not.toEqual(childBefore.identity)
    expect(
      database
        .query(
          `SELECT kind, value FROM workspace_aliases
           ORDER BY kind, value`,
        )
        .all(),
    ).toEqual([
      { kind: 'path', value: resolve(parentPath) },
      { kind: 'path', value: resolve(childPath) },
    ])
    expect(
      database
        .query(
          `SELECT workspace_id FROM workspace_aliases
           WHERE kind = 'git' AND value = ?`,
        )
        .get('github.com/team/owned-root-conflict'),
    ).toBeNull()
    database.close()
  })

  test('does not register a workspace when Git inspection fails', () => {
    const root = temporaryRoot()
    const repo = makeGitRepository(root, 'broken-repo')
    const dataDirectory = join(root, 'data')
    writeFileSync(join(repo, '.git', 'config'), '[broken\n')
    const continuum = createContinuum({ dataDirectory })

    expect(() => continuum.resolveWorkspace(repo)).toThrow(ContinuumError)
    try {
      continuum.resolveWorkspace(repo)
    } catch (error) {
      expect(error).toMatchObject({
        code: 'WORKSPACE_ERROR',
        operation: 'resolve workspace',
        message: 'Failed to inspect the workspace path.',
      })
    }
    continuum.close()

    const database = new Database(join(dataDirectory, 'continuum.db'))
    expect(countRows(database, 'workspaces')).toBe(0)
    expect(countRows(database, 'workspace_aliases')).toBe(0)
    database.close()
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
