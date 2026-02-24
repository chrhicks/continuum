import { describe, expect, test } from 'bun:test'

import {
  buildOpencodeSyncLedger,
  updateOpencodeSyncLedger,
  type OpencodeSyncProcessResult,
} from '../src/recall/sync/opencode-sync'
import { type OpencodeSyncPlan } from '../src/recall/diff/opencode-diff'

const buildPlan = (): OpencodeSyncPlan => ({
  version: 1,
  generated_at: '2026-02-20T00:00:00.000Z',
  index_file: '/data/recall/opencode/source-index.json',
  summary_dir: '/repo/.continuum/recall/opencode',
  report_file: '/data/recall/opencode/diff-report.json',
  project_scope: {
    project_ids: ['proj_a'],
    include_global: false,
    repo_path: '/repo',
  },
  stats: {
    total: 2,
    new: 1,
    stale: 1,
  },
  items: [
    {
      key: 'proj_a:ses_1',
      session_id: 'ses_1',
      project_id: 'proj_a',
      title: 'Session 1',
      status: 'new',
      reason: 'missing-summary',
      source_fingerprint: 'fp-1',
      source_updated_at: '2026-02-19T00:00:00.000Z',
      summary_fingerprint: null,
      summary_generated_at: null,
      summary_path: null,
    },
    {
      key: 'proj_a:ses_2',
      session_id: 'ses_2',
      project_id: 'proj_a',
      title: 'Session 2',
      status: 'stale',
      reason: 'source-newer',
      source_fingerprint: 'fp-2',
      source_updated_at: '2026-02-20T00:00:00.000Z',
      summary_fingerprint: 'sum-2',
      summary_generated_at: '2026-02-18T00:00:00.000Z',
      summary_path:
        '/repo/.continuum/recall/opencode/OPENCODE-SUMMARY-ses_2.md',
    },
  ],
})

describe('opencode sync ledger updates', () => {
  test('updates ledger for success and failed results', () => {
    const plan = buildPlan()
    const ledger = buildOpencodeSyncLedger(plan, 1, '2026-02-20T01:00:00.000Z')
    const now = '2026-02-20T02:00:00.000Z'
    const results: OpencodeSyncProcessResult[] = [
      {
        item: plan.items[0],
        status: 'success',
        command: 'echo ok',
        error: null,
      },
      {
        item: plan.items[1],
        status: 'failed',
        command: 'echo fail',
        error: 'boom',
      },
    ]

    const updated = updateOpencodeSyncLedger(ledger, results, now)

    expect(updated.entries['proj_a:ses_1']?.status).toBe('processed')
    expect(updated.entries['proj_a:ses_1']?.processed_at).toBe(now)
    expect(updated.entries['proj_a:ses_1']?.verified_at).toBe(now)
    expect(updated.entries['proj_a:ses_2']?.status).toBe('pending')
    expect(updated.entries['proj_a:ses_2']?.reason).toBe('failed: boom')
    expect(updated.entries['proj_a:ses_2']?.processed_at).toBeNull()
    expect(updated.entries['proj_a:ses_2']?.verified_at).toBe(now)
    expect(updated.stats.processed).toBe(1)
    expect(updated.stats.pending).toBe(1)
    expect(updated.generated_at).toBe(now)
  })

  test('updates ledger when no results succeed', () => {
    const plan = buildPlan()
    const ledger = buildOpencodeSyncLedger(plan, 1, '2026-02-20T01:00:00.000Z')
    const results: OpencodeSyncProcessResult[] = [
      {
        item: plan.items[0],
        status: 'failed',
        command: 'echo fail',
        error: 'boom',
      },
      {
        item: plan.items[1],
        status: 'skipped',
        command: null,
        error: 'dry-run',
      },
    ]

    const updated = updateOpencodeSyncLedger(
      ledger,
      results,
      '2026-02-20T03:00:00.000Z',
    )

    expect(updated.entries['proj_a:ses_1']?.status).toBe('pending')
    expect(updated.entries['proj_a:ses_1']?.reason).toBe('failed: boom')
    expect(updated.entries['proj_a:ses_1']?.processed_at).toBeNull()
    expect(updated.entries['proj_a:ses_1']?.verified_at).toBe(
      '2026-02-20T03:00:00.000Z',
    )
    expect(updated.entries['proj_a:ses_2']?.status).toBe('pending')
    expect(updated.entries['proj_a:ses_2']?.reason).toBe('skipped: dry-run')
    expect(updated.entries['proj_a:ses_2']?.processed_at).toBeNull()
    expect(updated.entries['proj_a:ses_2']?.verified_at).toBe(
      '2026-02-20T03:00:00.000Z',
    )
    expect(updated.stats.processed).toBe(0)
    expect(updated.stats.pending).toBe(2)
    expect(updated.generated_at).toBe('2026-02-20T03:00:00.000Z')
  })
})
