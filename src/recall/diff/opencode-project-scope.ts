import { resolve } from 'node:path'
import type {
  OpencodeDiffProjectScope,
  OpencodeProjectIndexRecord,
  OpencodeSourceIndex,
  OpencodeSourceIndexEntry,
  OpencodeSummaryEntry,
} from './opencode-diff-types'

export function resolveOpencodeProjectIdForRepo(
  projects: Record<string, OpencodeProjectIndexRecord>,
  repoPath: string,
): string | null {
  const normalizedRepo = resolve(repoPath)
  const match = Object.values(projects).find(
    (project) =>
      project.worktree && resolve(project.worktree) === normalizedRepo,
  )
  return match?.id ?? null
}

export function buildOpencodeDiffProjectScope(
  sourceIndex: OpencodeSourceIndex,
  repoPath: string,
  explicitProject: string | null,
  includeGlobal: boolean,
): OpencodeDiffProjectScope {
  const resolvedProject =
    explicitProject ??
    resolveOpencodeProjectIdForRepo(sourceIndex.projects ?? {}, repoPath)
  const projectIds = resolvedProject ? [resolvedProject] : []
  const scope = includeGlobal
    ? Array.from(new Set([...projectIds, 'global']))
    : projectIds

  if (scope.length === 0) {
    throw new Error(
      `No OpenCode project found for repo: ${repoPath}. Use --project or --include-global.`,
    )
  }

  return {
    project_ids: scope,
    include_global: includeGlobal,
    repo_path: repoPath,
  }
}

export function filterOpencodeSourceSessions(
  sessions: Record<string, OpencodeSourceIndexEntry>,
  projectIds: string[],
): Record<string, OpencodeSourceIndexEntry> {
  const allowed = new Set(projectIds)
  return Object.fromEntries(
    Object.entries(sessions).filter(([, entry]) =>
      allowed.has(entry.project_id),
    ),
  )
}

export function filterOpencodeSummaryEntries(
  entries: OpencodeSummaryEntry[],
  projectIds: string[],
): OpencodeSummaryEntry[] {
  const allowed = new Set(projectIds)
  return entries.filter((entry) => allowed.has(entry.project_id))
}
