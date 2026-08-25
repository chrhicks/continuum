import { existsSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import {
  resolveStorageAuthority,
  type StorageAccess,
  type StorageAuthority,
} from '../db/storage-authority'

export type WorkspaceContext = {
  invocationCwd: string
  requestedCwd: string | null
  workspaceRoot: string
  continuumDir: string
  memoryDir: string
  recallDir: string
  storageAuthority: StorageAuthority
  continuumDbPath: string
  opencodeDbPath: string
}

export type WorkspaceResolveOptions = {
  cwd?: string | null
  startDir?: string | null
  access?: StorageAccess
}

const CONTINUUM_DIR_NAME = '.continuum'
const MEMORY_DIR_NAME = 'memory'
const RECALL_DIR_PARTS = ['recall', 'opencode'] as const

export function resolveWorkspaceContext(
  options: WorkspaceResolveOptions = {},
): WorkspaceContext {
  const { invocationCwd, requestedCwd, workspaceRoot } =
    resolveWorkspaceRequest(options)
  const continuumDir = join(workspaceRoot, CONTINUUM_DIR_NAME)
  const memoryDir = join(continuumDir, MEMORY_DIR_NAME)
  const recallDir = join(continuumDir, ...RECALL_DIR_PARTS)
  const storageAuthority = resolveStorageAuthority(
    workspaceRoot,
    options.access ?? 'read-write',
  )

  return {
    invocationCwd,
    requestedCwd,
    workspaceRoot,
    continuumDir,
    memoryDir,
    recallDir,
    storageAuthority,
    continuumDbPath: storageAuthority.dbPath,
    opencodeDbPath: resolveDefaultOpencodeDbPath(),
  }
}

export function resolveWorkspaceRoot(
  options: WorkspaceResolveOptions = {},
): string {
  return resolveWorkspaceRequest(options).workspaceRoot
}

export function resolveFrom(baseDir: string, value: string): string {
  if (isAbsolute(value)) {
    return value
  }
  return resolve(baseDir, value)
}

function resolveWorkspaceRequest(options: WorkspaceResolveOptions): {
  invocationCwd: string
  requestedCwd: string | null
  workspaceRoot: string
} {
  const invocationCwd = resolve(options.startDir ?? process.cwd())
  const requestedCwd = options.cwd
    ? resolveFrom(invocationCwd, options.cwd)
    : null
  return {
    invocationCwd,
    requestedCwd,
    workspaceRoot: findWorkspaceRoot(requestedCwd ?? invocationCwd),
  }
}

function findWorkspaceRoot(startDir: string): string {
  let current = resolve(startDir)

  while (true) {
    if (isWorkspaceRoot(current)) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) {
      return resolve(startDir)
    }
    current = parent
  }
}

function isWorkspaceRoot(directory: string): boolean {
  return (
    hasDirectory(join(directory, CONTINUUM_DIR_NAME)) || hasGitMarker(directory)
  )
}

function hasGitMarker(directory: string): boolean {
  const gitPath = join(directory, '.git')
  if (!existsSync(gitPath)) {
    return false
  }
  return true
}

function hasDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function resolveDefaultOpencodeDbPath(): string {
  const dataHome = process.env.XDG_DATA_HOME
  return join(
    dataHome ?? join(homedir(), '.local', 'share'),
    'opencode',
    'opencode.db',
  )
}
