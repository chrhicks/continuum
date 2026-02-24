import { describe, expect, test } from 'bun:test'

import {
  buildOpencodeDiffReport,
  buildOpencodeSyncPlan,
  indexOpencodeSummaryEntries,
  type OpencodeDiffProjectScope,
  type OpencodeSummaryEntry,
} from '../src/recall/diff/opencode-diff'
import { type OpencodeSourceIndex } from '../src/recall/index/opencode-source-index'

const buildSourceIndex = (): OpencodeSourceIndex => {
  const buildEntry = (
    sessionId: string,
    updatedAt: string | null,
  ): OpencodeSourceIndex['sessions'][string] => ({
    key: `proj_a:${sessionId}`,
    session_id: sessionId,
    project_id: 'proj_a',
    title: `Session ${sessionId}`,
    slug: null,
    directory: '/repo',
    created_at: '2026-02-10T00:00:00.000Z',
    updated_at: updatedAt,
    message_count: 1,
    part_count: 1,
    message_latest_mtime_ms: null,
    part_latest_mtime_ms: null,
    session_file: `/data/opencode.db#session:${sessionId}`,
    message_dir: null,
    session_mtime_ms: null,
    fingerprint: `fp-${sessionId}`,
  })

  return {
    version: 2,
    generated_at: '2026-02-12T00:00:00.000Z',
    storage_root: '/data/opencode',
    db_path: '/data/opencode.db',
    data_root: '/data',
    index_file: '/data/recall/opencode/source-index.json',
    filters: {
      project_id: null,
      session_id: null,
    },
    projects: {
      proj_a: { id: 'proj_a', worktree: '/repo' },
    },
    sessions: {
      'proj_a:ses_new': buildEntry('ses_new', '2026-02-12T00:00:00.000Z'),
      'proj_a:ses_stale': buildEntry('ses_stale', '2026-02-12T00:00:00.000Z'),
      'proj_a:ses_ok': buildEntry('ses_ok', '2026-02-10T00:00:00.000Z'),
      'proj_a:ses_unknown': buildEntry('ses_unknown', null),
    },
    stats: {
      project_count: 1,
      session_count: 4,
    },
  }
}

const buildSummaryEntry = (
  sessionId: string,
  generatedAt: string | null,
): OpencodeSummaryEntry => ({
  key: `proj_a:${sessionId}`,
  session_id: sessionId,
  project_id: 'proj_a',
  summary_path: `/repo/.continuum/recall/opencode/OPENCODE-SUMMARY-${sessionId}.md`,
  summary_generated_at: generatedAt,
  summary_generated_at_ms: generatedAt ? Date.parse(generatedAt) : null,
  summary_model: 'test',
  summary_chunks: 1,
  summary_mtime_ms: generatedAt ? Date.parse(generatedAt) : null,
  summary_fingerprint: `sum-${sessionId}`,
})

describe('opencode diff + sync plan', () => {
  test('classifies diff entries and builds sync plans', () => {
    const sourceIndex = buildSourceIndex()
    const summaryEntries: OpencodeSummaryEntry[] = [
      buildSummaryEntry('ses_stale', '2026-02-11T00:00:00.000Z'),
      buildSummaryEntry('ses_ok', '2026-02-12T00:00:00.000Z'),
      buildSummaryEntry('ses_unknown', null),
      buildSummaryEntry('ses_orphan', '2026-02-10T00:00:00.000Z'),
    ]
    const summaryIndex = indexOpencodeSummaryEntries(summaryEntries)
    const projectScope: OpencodeDiffProjectScope = {
      project_ids: ['proj_a'],
      include_global: false,
      repo_path: '/repo',
    }

    const report = buildOpencodeDiffReport(
      sourceIndex,
      summaryIndex,
      '/repo/.continuum/recall/opencode',
      projectScope,
    )

    expect(report.stats.new).toBe(1)
    expect(report.stats.stale).toBe(1)
    expect(report.stats.unchanged).toBe(1)
    expect(report.stats.unknown).toBe(1)
    expect(report.stats.orphan).toBe(1)
    expect(report.new[0]?.key).toBe('proj_a:ses_new')
    expect(report.stale[0]?.reason).toBe('source-newer')
    expect(report.unknown[0]?.reason).toBe('missing-timestamp')
    expect(report.orphan[0]?.reason).toBe('missing-source')

    const plan = buildOpencodeSyncPlan(
      report,
      '/data/recall/opencode/diff-report.json',
    )
    expect(plan.stats.total).toBe(2)
    expect(plan.stats.new).toBe(1)
    expect(plan.stats.stale).toBe(1)
    expect(plan.items[0]?.status).toBe('new')
    expect(plan.items[1]?.status).toBe('stale')
  })

  test('indexes summaries and tracks duplicates by recency', () => {
    const older = buildSummaryEntry('ses_dup', '2026-02-10T00:00:00.000Z')
    const newer = {
      ...buildSummaryEntry('ses_dup', '2026-02-11T00:00:00.000Z'),
      summary_path: '/repo/.continuum/recall/opencode/OPENCODE-SUMMARY-new.md',
    }
    const indexed = indexOpencodeSummaryEntries([older, newer])

    expect(indexed.summaries['proj_a:ses_dup']?.summary_path).toBe(
      '/repo/.continuum/recall/opencode/OPENCODE-SUMMARY-new.md',
    )
    expect(indexed.duplicates).toEqual([
      {
        key: 'proj_a:ses_dup',
        kept: '/repo/.continuum/recall/opencode/OPENCODE-SUMMARY-new.md',
        dropped: '/repo/.continuum/recall/opencode/OPENCODE-SUMMARY-ses_dup.md',
      },
    ])
  })
})
