import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

const DEFAULT_RECALL_DIR = join('.continuum', 'recall', 'opencode')

export type OpencodeArtifactKind =
  | 'session'
  | 'normalized'
  | 'summary'
  | 'summaryMeta'

const ARTIFACT_PREFIXES: Record<OpencodeArtifactKind, string> = {
  session: 'OPENCODE',
  normalized: 'OPENCODE-NORMALIZED',
  summary: 'OPENCODE-SUMMARY',
  summaryMeta: 'OPENCODE-SUMMARY-META',
}

export const SUMMARY_PREFIX = `${ARTIFACT_PREFIXES.summary}-`

const ARTIFACT_EXTENSIONS: Record<OpencodeArtifactKind, string> = {
  session: 'md',
  normalized: 'md',
  summary: 'md',
  summaryMeta: 'json',
}

export function resolveOpencodeDbPath(value?: string | null): string {
  if (value) {
    return isAbsolute(value) ? value : resolve(process.cwd(), value)
  }
  const dataHome = process.env.XDG_DATA_HOME
  return join(
    dataHome ?? join(homedir(), '.local', 'share'),
    'opencode',
    'opencode.db',
  )
}

export function resolveOpencodeOutputDir(
  repoPath: string,
  outArg?: string | null,
): string {
  if (!outArg) {
    return resolve(repoPath, DEFAULT_RECALL_DIR)
  }
  return isAbsolute(outArg) ? outArg : resolve(repoPath, outArg)
}

export function formatTimestampForFilename(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown'
  return new Date(value).toISOString().replace(/:/g, '-').slice(0, 19)
}

export function buildOpencodeArtifactFilename(
  kind: OpencodeArtifactKind,
  createdAt?: number | null,
  sessionId?: string | null,
): string {
  const prefix = ARTIFACT_PREFIXES[kind]
  const extension = ARTIFACT_EXTENSIONS[kind]
  const stamp = formatTimestampForFilename(createdAt)
  const id = sessionId?.trim() || 'unknown'
  return `${prefix}-${stamp}-${id}.${extension}`
}
