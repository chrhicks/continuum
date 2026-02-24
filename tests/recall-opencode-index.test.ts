import { describe, expect, test } from 'bun:test'
import { join, resolve } from 'node:path'

import {
  buildOpencodeSessionFingerprint,
  buildOpencodeSessionIndexEntry,
  resolveOpencodeSourceIndexFile,
  resolveRecallDataRoot,
  type OpencodeSessionRow,
  type OpencodeSessionStats,
} from '../src/recall/index/opencode-source-index'

describe('opencode source index helpers', () => {
  test('resolves recall data root from XDG_DATA_HOME', () => {
    const original = process.env.XDG_DATA_HOME
    process.env.XDG_DATA_HOME = '/tmp/xdg-data'
    try {
      expect(resolveRecallDataRoot()).toBe(join('/tmp/xdg-data', 'continuum'))
    } finally {
      if (original === undefined) {
        delete process.env.XDG_DATA_HOME
      } else {
        process.env.XDG_DATA_HOME = original
      }
    }
  })

  test('resolves source index file from data root', () => {
    expect(resolveOpencodeSourceIndexFile('/data/root')).toBe(
      '/data/root/recall/opencode/source-index.json',
    )
    expect(
      resolveOpencodeSourceIndexFile('/data/root', 'custom/index.json'),
    ).toBe(resolve(process.cwd(), 'custom/index.json'))
  })

  test('builds deterministic session fingerprints', () => {
    const first = buildOpencodeSessionFingerprint(['alpha', 1, null])
    const second = buildOpencodeSessionFingerprint(['alpha', 1, null])
    const third = buildOpencodeSessionFingerprint(['alpha', 2, null])
    expect(first).toBe(second)
    expect(first).not.toBe(third)
    expect(first).toMatch(/^[a-f0-9]{64}$/)
  })

  test('builds session index entries with stats and defaults', () => {
    const session: OpencodeSessionRow = {
      id: 'ses_123',
      project_id: 'proj_1',
      slug: 'slug',
      title: 'Sample Session',
      directory: null,
      version: '1',
      summary_additions: 1,
      summary_deletions: 2,
      summary_files: 3,
      time_created: Date.parse('2026-02-01T00:00:00Z'),
      time_updated: Date.parse('2026-02-01T01:00:00Z'),
    }
    const stats: OpencodeSessionStats = {
      message_count: 2,
      part_count: 4,
      message_latest_ms: Date.parse('2026-02-01T01:05:00Z'),
      part_latest_ms: null,
    }

    const entry = buildOpencodeSessionIndexEntry(
      session,
      { id: 'proj_1', worktree: '/repo' },
      stats,
      '/data/opencode.db',
    )
    const entryUpdated = buildOpencodeSessionIndexEntry(
      session,
      { id: 'proj_1', worktree: '/repo' },
      { ...stats, part_count: 5 },
      '/data/opencode.db',
    )

    expect(entry.key).toBe('proj_1:ses_123')
    expect(entry.directory).toBe('/repo')
    expect(entry.session_file).toBe('/data/opencode.db#session:ses_123')
    expect(entry.message_count).toBe(2)
    expect(entry.part_count).toBe(4)
    expect(entry.session_mtime_ms).toBe(session.time_updated)
    expect(entry.fingerprint).not.toBe(entryUpdated.fingerprint)
  })
})
