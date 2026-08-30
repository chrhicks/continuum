import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

export type GitRemote = {
  name: string
  value: string
}

export type InspectedWorkspace = {
  rootPath: string
  remotes: GitRemote[]
}

export function inspectWorkspace(path: string): InspectedWorkspace {
  const gitRoot = runGit(path, ['rev-parse', '--show-toplevel'])
  if (!gitRoot) {
    return { rootPath: realpathSync(path), remotes: [] }
  }

  const rootPath = realpathSync(resolve(gitRoot))
  const remoteNames = runGit(rootPath, ['remote'])
    ?.split('\n')
    .map((name) => name.trim())
    .filter(Boolean)
  const remotes = (remoteNames ?? []).flatMap((name) => {
    const remote = runGit(rootPath, ['remote', 'get-url', name])
    if (!remote) return []
    return [{ name, value: normalizeGitRemote(remote, rootPath) }]
  })

  remotes.sort((left, right) => {
    if (left.name === 'origin') return -1
    if (right.name === 'origin') return 1
    return left.name.localeCompare(right.name)
  })

  return { rootPath, remotes: uniqueRemotes(remotes) }
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
    return normalizeRemoteParts(scp[1]!, scp[2]!)
  }

  try {
    const url = new URL(value)
    if (url.protocol === 'file:') {
      return `file:${resolve(decodeURIComponent(url.pathname))}`
    }
    if (url.hostname) return normalizeRemoteParts(url.hostname, url.pathname)
  } catch {
    // Local filesystem remotes are useful in development and remain path based.
  }

  return `file:${resolve(baseDirectory, value.replace(/\.git\/?$/, ''))}`
}

function runGit(path: string, args: string[]): string | null {
  const result = spawnSync('git', ['-C', path, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.status !== 0) return null
  return result.stdout.trim() || null
}

function normalizeRemoteParts(hostname: string, pathname: string): string {
  const path = pathname
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
  return `${hostname.toLowerCase()}/${path}`
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
