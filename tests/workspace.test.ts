import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  observeStorageAuthority,
  resolveStorageAuthority,
} from '../src/db/storage-authority'
import { workspaceClaimPath } from '../src/db/workspace-registry'
import { resolveWorkspaceContext } from '../src/workspace/resolve'

function withTempDir(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'continuum-workspace-'))
  try {
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('resolveWorkspaceContext', () => {
  test('walks upward to nearest .continuum directory', () => {
    withTempDir((root) => {
      mkdirSync(join(root, '.continuum'), { recursive: true })
      const nested = join(root, 'apps', 'web', 'src')
      mkdirSync(nested, { recursive: true })

      const context = resolveWorkspaceContext({ startDir: nested })

      expect(context.workspaceRoot).toBe(root)
      expect(context.continuumDir).toBe(join(root, '.continuum'))
      expect(context.memoryDir).toBe(join(root, '.continuum', 'memory'))
      expect(context.storageAuthority.mode).toBe('claimed')
      expect(context.continuumDbPath).toBe(context.storageAuthority.dbPath)
    })
  })

  test('falls back to nearest .git directory before creating .continuum', () => {
    withTempDir((root) => {
      mkdirSync(join(root, '.git'), { recursive: true })
      const nested = join(root, 'packages', 'cli')
      mkdirSync(nested, { recursive: true })

      const context = resolveWorkspaceContext({ startDir: nested })

      expect(context.workspaceRoot).toBe(root)
      expect(context.storageAuthority.mode).toBe('deferred')
    })
  })

  test('uses explicit target cwd before walking upward', () => {
    withTempDir((root) => {
      const repo = join(root, 'repo')
      const nested = join(repo, 'nested')
      mkdirSync(join(repo, '.git'), { recursive: true })
      mkdirSync(nested, { recursive: true })

      const context = resolveWorkspaceContext({
        startDir: root,
        cwd: './repo/nested',
      })

      expect(context.requestedCwd).toBe(nested)
      expect(context.workspaceRoot).toBe(repo)
    })
  })

  test('falls back to the start directory when no markers exist', () => {
    withTempDir((root) => {
      const nested = join(root, 'scratch')
      mkdirSync(nested, { recursive: true })

      const context = resolveWorkspaceContext({ startDir: nested })

      expect(context.workspaceRoot).toBe(nested)
      expect(context.storageAuthority.mode).toBe('deferred')
    })
  })

  test('observes stable authority without publishing identity or claim data', () => {
    withTempDir((root) => {
      const workspace = join(root, 'workspace')
      const dataHome = join(root, 'data')
      const identityPath = join(workspace, '.continuum', 'workspace.json')
      const projectId = '00000000-0000-4000-8000-000000000001'
      mkdirSync(join(workspace, '.continuum'), { recursive: true })
      writeFileSync(
        identityPath,
        `${JSON.stringify({ version: 1, id: projectId })}\n`,
      )
      const before = readFileSync(identityPath, 'utf8')

      const authority = observeStorageAuthority(workspace, { dataHome })

      expect(authority.mode).toBe('observed')
      expect(authority.workspacePath).toBe(workspace)
      expect(authority.projectId).toBe(projectId)
      expect(authority.dataHome).toBe(dataHome)
      expect(readFileSync(identityPath, 'utf8')).toBe(before)
      expect(existsSync(workspaceClaimPath(projectId, dataHome))).toBe(false)
      expect(existsSync(dataHome)).toBe(false)
    })
  })

  test('defers uninitialized read-write authority without creating metadata', () => {
    withTempDir((root) => {
      const workspace = join(root, 'workspace')
      const dataHome = join(root, 'data')
      mkdirSync(join(workspace, '.git'), { recursive: true })

      const authority = resolveStorageAuthority(workspace, 'read-write', {
        dataHome,
      })

      expect(authority.mode).toBe('deferred')
      expect(authority.workspacePath).toBe(workspace)
      expect(authority.dbPath).toBe(
        join(
          dataHome,
          'continuum',
          'projects',
          authority.projectId,
          'continuum.db',
        ),
      )
      expect(existsSync(join(workspace, '.continuum'))).toBe(false)
      expect(existsSync(dataHome)).toBe(false)
    })
  })
})
