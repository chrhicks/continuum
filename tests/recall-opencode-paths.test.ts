import { describe, expect, test } from 'bun:test'
import { join, resolve } from 'node:path'

import {
  buildOpencodeArtifactFilename,
  formatTimestampForFilename,
  resolveOpencodeDbPath,
  resolveOpencodeOutputDir,
} from '../src/recall/opencode/paths'

describe('opencode recall path helpers', () => {
  test('resolves explicit db path values', () => {
    const relative = 'data/opencode.db'
    expect(resolveOpencodeDbPath(relative)).toBe(
      resolve(process.cwd(), relative),
    )
    expect(resolveOpencodeDbPath('/tmp/opencode.db')).toBe('/tmp/opencode.db')
  })

  test('uses XDG_DATA_HOME for default db path', () => {
    const original = process.env.XDG_DATA_HOME
    process.env.XDG_DATA_HOME = '/tmp/xdg-data'
    try {
      expect(resolveOpencodeDbPath()).toBe(
        join('/tmp/xdg-data', 'opencode', 'opencode.db'),
      )
    } finally {
      if (original === undefined) {
        delete process.env.XDG_DATA_HOME
      } else {
        process.env.XDG_DATA_HOME = original
      }
    }
  })

  test('resolves output dirs relative to repo path', () => {
    expect(resolveOpencodeOutputDir('/repo')).toBe(
      '/repo/.continuum/recall/opencode',
    )
    expect(resolveOpencodeOutputDir('/repo', 'out/recall')).toBe(
      '/repo/out/recall',
    )
    expect(resolveOpencodeOutputDir('/repo', '/tmp/recall')).toBe('/tmp/recall')
  })

  test('formats timestamps for filenames', () => {
    const stamp = formatTimestampForFilename(Date.parse('2026-02-10T12:34:56Z'))
    expect(stamp).toBe('2026-02-10T12-34-56')
    expect(formatTimestampForFilename()).toBe('unknown')
  })

  test('builds artifact filenames by kind', () => {
    expect(buildOpencodeArtifactFilename('session', 0, 'ses_123')).toBe(
      'OPENCODE-1970-01-01T00-00-00-ses_123.md',
    )
    expect(buildOpencodeArtifactFilename('normalized', 0, 'ses_123')).toBe(
      'OPENCODE-NORMALIZED-1970-01-01T00-00-00-ses_123.md',
    )
    expect(buildOpencodeArtifactFilename('summary', 0, 'ses_123')).toBe(
      'OPENCODE-SUMMARY-1970-01-01T00-00-00-ses_123.md',
    )
    expect(buildOpencodeArtifactFilename('summaryMeta', 0, 'ses_123')).toBe(
      'OPENCODE-SUMMARY-META-1970-01-01T00-00-00-ses_123.json',
    )
  })
})
