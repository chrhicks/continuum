import type {
  OpencodeDiffReport,
  OpencodeSyncPlan,
  OpencodeSyncPlanItem,
} from './opencode-diff-types'

export function buildOpencodeSyncPlan(
  report: OpencodeDiffReport,
  reportFile: string | null,
): OpencodeSyncPlan {
  const items = [...report.new, ...report.stale]
    .filter((entry) => entry.session_id && entry.project_id)
    .map<OpencodeSyncPlanItem>((entry) => ({
      key: entry.key,
      session_id: entry.session_id as string,
      project_id: entry.project_id as string,
      title: entry.title,
      status: entry.status === 'stale' ? 'stale' : 'new',
      reason: entry.reason,
      source_fingerprint: entry.source_fingerprint,
      source_updated_at: entry.source_updated_at,
      summary_fingerprint: entry.summary_fingerprint,
      summary_generated_at: entry.summary_generated_at,
      summary_path: entry.summary_path,
    }))

  const newCount = items.filter((item) => item.status === 'new').length
  const staleCount = items.filter((item) => item.status === 'stale').length

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    index_file: report.index_file,
    summary_dir: report.summary_dir,
    report_file: reportFile,
    project_scope: report.project_scope,
    stats: {
      total: items.length,
      new: newCount,
      stale: staleCount,
    },
    items,
  }
}
