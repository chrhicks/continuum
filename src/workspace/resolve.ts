import { existsSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'

export type WorkspaceContext = {
  invocationCwd: string
  requestedCwd: string | null
  workspaceRoot: string
  continuumDir: string
  memoryDir: string
  recallDir: string
  continuumDbPath: string
  opencodeDbPath: string
}

export type WorkspaceResolveOptions = {
  cwd?: string | null
  startDir?: string | null
}

const CONTINUUM_DIR_NAME = '.continuum'
const MEMORY_DIR_NAME = 'memory'
const RECALL_DIR_PARTS = ['recall', 'opencode'] as const
const CONTINUUM_DB_FILE = 'continuum.db'

export function resolveWorkspaceContext(
  options: WorkspaceResolveOptions = {},
): WorkspaceContext {
  const invocationCwd = resolve(options.startDir ?? process.cwd())
  const requestedCwd = options.cwd
    ? resolveFrom(invocationCwd, options.cwd)
    : null
  const rootCandidate = requestedCwd ?? invocationCwd
  const workspaceRoot = findWorkspaceRoot(rootCandidate)
  const continuumDir = join(workspaceRoot, CONTINUUM_DIR_NAME)
  const memoryDir = join(continuumDir, MEMORY_DIR_NAME)
  const recallDir = join(continuumDir, ...RECALL_DIR_PARTS)

  return {
    invocationCwd,
    requestedCwd,
    workspaceRoot,
    continuumDir,
    memoryDir,
    recallDir,
    continuumDbPath: join(continuumDir, CONTINUUM_DB_FILE),
    opencodeDbPath: resolveDefaultOpencodeDbPath(),
  }
}

export function resolveWorkspaceRoot(
  options: WorkspaceResolveOptions = {},
): string {
  return resolveWorkspaceContext(options).workspaceRoot
}

export function resolveFrom(baseDir: string, value: string): string {
  if (isAbsolute(value)) {
    return value
  }
  return resolve(baseDir, value)
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
