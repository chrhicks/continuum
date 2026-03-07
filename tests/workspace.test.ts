import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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
    })
  })

  test('falls back to nearest .git directory before creating .continuum', () => {
    withTempDir((root) => {
      mkdirSync(join(root, '.git'), { recursive: true })
      const nested = join(root, 'packages', 'cli')
      mkdirSync(nested, { recursive: true })

      const context = resolveWorkspaceContext({ startDir: nested })

      expect(context.workspaceRoot).toBe(root)
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
    })
  })
})
