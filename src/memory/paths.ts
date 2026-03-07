import { mkdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { getActiveWorkspaceContext } from '../workspace/context'
import {
  type WorkspaceContext,
  resolveWorkspaceContext,
} from '../workspace/resolve'

export const CONTINUUM_DIR_NAME = '.continuum'
export const MEMORY_DIR_NAME = 'memory'

export function getWorkspaceContext(): WorkspaceContext {
  return getActiveWorkspaceContext() ?? resolveWorkspaceContext()
}

export function continuumPath(...segments: string[]): string {
  return join(getWorkspaceContext().continuumDir, ...segments)
}

export function resolveMemoryDir(): string {
  return getWorkspaceContext().memoryDir
}

export function ensureMemoryDir(): void {
  mkdirSync(resolveMemoryDir(), { recursive: true })
}

export function memoryPath(...segments: string[]): string {
  return join(resolveMemoryDir(), ...segments)
}

export function formatWorkspacePath(path: string): string {
  const relativePath = relative(getWorkspaceContext().workspaceRoot, path)
  return relativePath.length > 0 ? relativePath : path
}
