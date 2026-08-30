import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

export type GitRemote = {
  name: string
  value: string
}

export type InspectedWorkspace = {
  requestedPath: string
  rootPath: string
  remotes: GitRemote[]
}

export function inspectWorkspace(path: string): InspectedWorkspace {
  const requestedPath = realpathSync(path)
  const gitRoot = findGitRoot(requestedPath)
  if (!gitRoot) {
    return { requestedPath, rootPath: requestedPath, remotes: [] }
  }

  const rootPath = realpathSync(resolve(gitRoot))
  const remoteNames = runGit(rootPath, ['remote'])
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean)
  const remotes = remoteNames.map((name) => ({
    name,
    value: normalizeGitRemote(
      requireGitOutput(rootPath, ['remote', 'get-url', name]),
      rootPath,
    ),
  }))

  remotes.sort((left, right) => {
    if (left.name === 'origin') return -1
    if (right.name === 'origin') return 1
    return left.name.localeCompare(right.name)
  })

  return { requestedPath, rootPath, remotes: uniqueRemotes(remotes) }
}

export function normalizeGitRemote(
  remote: string,
  baseDirectory: string = process.cwd(),
): string {
  const value = remote.trim()
  const scp = value.includes('://')
    ? null
    : value.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/)
  if (scp && !looksLikeWindowsPath(value)) {
    return normalizeNetworkRemote(scp[1]!, scp[2]!)
  }

  try {
    const url = new URL(value)
    if (url.protocol === 'file:') {
      return normalizeLocalRemote(decodeURIComponent(url.pathname))
    }
    if (url.hostname) {
      const port = isDefaultPort(url.protocol, url.port) ? '' : url.port
      const host = port ? `${url.hostname}:${port}` : url.hostname
      return normalizeNetworkRemote(host, url.pathname)
    }
  } catch {
    // Local filesystem remotes are valid and do not need URL syntax.
  }

  return normalizeLocalRemote(resolve(baseDirectory, value))
}

function findGitRoot(path: string): string | null {
  const result = executeGit(path, ['rev-parse', '--show-toplevel'])
  if (result.status === 0) return result.stdout.trim()
  if (result.stderr.includes('not a git repository')) return null
  throw gitInspectionError(result.stderr)
}

function runGit(path: string, args: string[]): string {
  const result = executeGit(path, args)
  if (result.status !== 0) throw gitInspectionError(result.stderr)
  return result.stdout.trim()
}

function requireGitOutput(path: string, args: string[]): string {
  const output = runGit(path, args)
  if (!output) throw gitInspectionError('Git returned no remote URL.')
  return output
}

function executeGit(
  path: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('git', ['-C', path, ...args], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) throw gitInspectionError(result.error.message)
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

function gitInspectionError(detail: string): Error {
  return new Error('Git workspace inspection failed.', {
    cause: detail.trim() || undefined,
  })
}

function normalizeNetworkRemote(hostname: string, pathname: string): string {
  const path = pathname
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
  return `${hostname.toLowerCase()}/${path}`
}

function normalizeLocalRemote(path: string): string {
  return `file:${resolve(path)}`
}

function isDefaultPort(protocol: string, port: string): boolean {
  return (
    !port ||
    (protocol === 'ssh:' && port === '22') ||
    (protocol === 'https:' && port === '443') ||
    (protocol === 'http:' && port === '80') ||
    (protocol === 'git:' && port === '9418')
  )
}

function looksLikeWindowsPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value)
}

function uniqueRemotes(remotes: GitRemote[]): GitRemote[] {
  const seen = new Set<string>()
  return remotes.filter((remote) => {
    if (seen.has(remote.value)) return false
    seen.add(remote.value)
    return true
  })
}
