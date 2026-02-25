import { describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  consolidateNow,
  dedupeEntriesByAnchor,
  insertEntryInSection,
} from '../src/memory/consolidate'

async function withTempCwd(run: () => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'continuum-cli-'))
  const previous = process.cwd()
  try {
    process.chdir(root)
    await run()
  } finally {
    process.chdir(previous)
    rmSync(root, { recursive: true, force: true })
  }
}

describe('memory index de-duplication', () => {
  test('dedupeEntriesByAnchor keeps first entry for the same anchor', () => {
    const entry = [
      '## Session 2026-02-02 02:00 (1m)',
      '',
      '**Link**: [Full details](MEMORY-2026-02-02.md#session-2026-02-02-02-00-abc)',
    ].join('\n')
    const duplicate = [
      '## Session 2026-02-02 02:00 (1m)',
      '',
      '**Link**: [Full details](MEMORY-2026-02-02.md#session-2026-02-02-02-00-abc)',
    ].join('\n')

    const deduped = dedupeEntriesByAnchor([entry, duplicate])

    expect(deduped).toHaveLength(1)
    expect(deduped[0]).toBe(entry)
  })

  test('insertEntryInSection skips entries with duplicate anchors', () => {
    const existing =
      '- **[Session 2026-02-02 02:00](MEMORY-2026-02-02.md#session-abc)** - Session work'
    const content = [
      '# Long-term Memory Index',
      '',
      '## Sessions',
      existing,
      '',
    ].join('\n')

    const unchanged = insertEntryInSection(content, 'Sessions', existing)
    expect(unchanged).toBe(content)

    const additional =
      '- **[Session 2026-02-02 02:01](MEMORY-2026-02-02.md#session-def)** - Session work'
    const updated = insertEntryInSection(content, 'Sessions', additional)
    const sessionLines = updated
      .split('\n')
      .filter((line) => line.includes('#session-'))

    expect(sessionLines).toHaveLength(2)
    expect(updated).toContain(existing)
    expect(updated).toContain(additional)
  })

  test('insertEntryInSection dedupes anchors after blank lines', () => {
    const existing =
      '- **[Session 2026-02-02 02:00](MEMORY-2026-02-02.md#session-abc)** - Session work'
    const content = [
      '# Long-term Memory Index',
      '',
      '## Sessions',
      '',
      existing,
      '',
      '## Other',
      '',
    ].join('\n')

    const unchanged = insertEntryInSection(content, 'Sessions', existing)
    expect(unchanged).toBe(content)

    const additional =
      '- **[Session 2026-02-02 02:01](MEMORY-2026-02-02.md#session-def)** - Session work'
    const updated = insertEntryInSection(content, 'Sessions', additional)
    const sessionLines = updated
      .split('\n')
      .filter((line) => line.includes('#session-'))

    expect(sessionLines).toHaveLength(2)
    expect(updated).toContain(existing)
    expect(updated).toContain(additional)
  })

  test('consolidateNow removes duplicate anchors already in MEMORY.md', async () => {
    await withTempCwd(async () => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })

      const nowPath = join(memoryDir, 'NOW-2026-02-02T16-00-00.md')
      const nowContent = [
        '---',
        'session_id: sess_test',
        'timestamp_start: 2026-02-02T16:00:00.000Z',
        'timestamp_end: 2026-02-02T16:05:00.000Z',
        'duration_minutes: null',
        `project_path: ${process.cwd()}`,
        'tags: []',
        'parent_session: null',
        'related_tasks: []',
        'memory_type: NOW',
        '---',
        '',
        '# Session: sess_test - 2026-02-02 16:00 UTC',
        '',
        '@decision: cleanup duplicate anchors',
        '',
      ].join('\n')
      writeFileSync(nowPath, nowContent, 'utf-8')

      const memoryIndexPath = join(memoryDir, 'MEMORY.md')
      const duplicateAnchor = 'session-dup'
      const duplicateEntry = `- **[Session 2026-02-01 10:00](MEMORY-2026-02-01.md#${duplicateAnchor})** - duplicate`
      const indexContent = [
        '# Long-term Memory Index',
        '',
        '## Architecture Decisions',
        duplicateEntry,
        duplicateEntry,
        '',
        '## Sessions',
        '',
      ].join('\n')
      writeFileSync(memoryIndexPath, indexContent, 'utf-8')

      await consolidateNow({ nowPath })

      const updatedIndex = readFileSync(memoryIndexPath, 'utf-8')
      const matches =
        updatedIndex.match(new RegExp(`#${duplicateAnchor}`, 'g')) ?? []
      expect(matches).toHaveLength(1)
    })
  })
})

describe('memory consolidation dry run', () => {
  test('does not write files', async () => {
    await withTempCwd(async () => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })
      const nowPath = join(memoryDir, 'NOW-2026-02-02T16-00-00.md')
      const content = [
        '---',
        'session_id: sess_test',
        'timestamp_start: 2026-02-02T16:00:00.000Z',
        'timestamp_end: 2026-02-02T16:05:00.000Z',
        'duration_minutes: null',
        `project_path: ${process.cwd()}`,
        'tags: []',
        'parent_session: null',
        'related_tasks: []',
        'memory_type: NOW',
        '---',
        '',
        '# Session: sess_test - 2026-02-02 16:00 UTC',
        '',
        '@decision: test decision',
        '@discovery: test discovery',
        '',
      ].join('\n')
      writeFileSync(nowPath, content, 'utf-8')

      const before = readFileSync(nowPath, 'utf-8')
      const result = await consolidateNow({ nowPath, dryRun: true })
      const after = readFileSync(nowPath, 'utf-8')

      expect(result.dryRun).toBe(true)
      expect(result.preview?.recentLines).toBeGreaterThan(0)
      expect(after).toBe(before)
      expect(readdirSync(memoryDir)).toEqual(['NOW-2026-02-02T16-00-00.md'])
    })
  })
})

describe('memory consolidation focus', () => {
  test('produces narrative when no markers exist', async () => {
    await withTempCwd(async () => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })
      const nowPath = join(memoryDir, 'NOW-2026-02-02T16-00-00.md')
      const content = [
        '---',
        'session_id: sess_test',
        'timestamp_start: 2026-02-02T16:00:00.000Z',
        'timestamp_end: 2026-02-02T16:05:00.000Z',
        'duration_minutes: null',
        `project_path: ${process.cwd()}`,
        'tags: []',
        'parent_session: null',
        'related_tasks: []',
        'memory_type: NOW',
        '---',
        '',
        '# Session: sess_test - 2026-02-02 16:00 UTC',
        '',
      ].join('\n')
      writeFileSync(nowPath, content, 'utf-8')

      await consolidateNow({ nowPath })

      const recent = readFileSync(join(memoryDir, 'RECENT.md'), 'utf-8')
      // With the mechanical path, sparse sessions produce a minimal narrative
      expect(recent).toContain('## Session 2026-02-02 16:00')
      expect(recent).toContain('No summary available.')
    })
  })

  test('preserves the valid session header when clearing NOW content', async () => {
    await withTempCwd(async () => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })
      const nowPath = join(memoryDir, 'NOW-2026-02-02T16-00-00.md')
      const content = [
        '---',
        'session_id: sess_valid',
        'timestamp_start: 2026-02-02T16:00:00.000Z',
        'timestamp_end: 2026-02-02T16:05:00.000Z',
        'duration_minutes: null',
        `project_path: ${process.cwd()}`,
        'tags: []',
        'parent_session: null',
        'related_tasks: []',
        'memory_type: NOW',
        '---',
        '',
        '# Session: sess_valid - 2026-02-02 16:00 UTC',
        '',
        '# Notes',
        'this should be cleared',
        '@decision: should be cleared',
        '',
      ].join('\n')
      writeFileSync(nowPath, content, 'utf-8')

      await consolidateNow({ nowPath })

      const updated = readFileSync(nowPath, 'utf-8')
      expect(updated).toContain('# Session: sess_valid - 2026-02-02 16:00 UTC')
      expect(updated).not.toContain('# Notes')
      expect(updated).not.toContain('@decision: should be cleared')
    })
  })

  test('preserves first level-1 header when session header is absent', async () => {
    await withTempCwd(async () => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })
      const nowPath = join(memoryDir, 'NOW-2026-02-02T16-00-00.md')
      const content = [
        '---',
        'session_id: sess_no_session_header',
        'timestamp_start: 2026-02-02T16:00:00.000Z',
        'timestamp_end: 2026-02-02T16:05:00.000Z',
        'duration_minutes: null',
        `project_path: ${process.cwd()}`,
        'tags: []',
        'parent_session: null',
        'related_tasks: []',
        'memory_type: NOW',
        '---',
        '',
        '# Notes from Session',
        '',
        '@decision: should be cleared',
        'detail line should be cleared',
        '',
      ].join('\n')
      writeFileSync(nowPath, content, 'utf-8')

      await consolidateNow({ nowPath })

      const updated = readFileSync(nowPath, 'utf-8')
      expect(updated).toContain('# Notes from Session')
      expect(updated).not.toContain('@decision: should be cleared')
      expect(updated).not.toContain('detail line should be cleared')
    })
  })

  test('consolidateNow is idempotent for cleared NOW files', async () => {
    await withTempCwd(async () => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })
      const nowPath = join(memoryDir, 'NOW-2026-02-02T16-00-00.md')
      const content = [
        '---',
        'session_id: sess_idempotent',
        'timestamp_start: 2026-02-02T16:00:00.000Z',
        'timestamp_end: 2026-02-02T16:05:00.000Z',
        'duration_minutes: null',
        `project_path: ${process.cwd()}`,
        'tags: []',
        'parent_session: null',
        'related_tasks: []',
        'memory_type: NOW',
        '---',
        '',
        '# Session: sess_idempotent - 2026-02-02 16:00 UTC',
        '',
        '@decision: should be cleared once',
        'body line should be cleared once',
        '',
      ].join('\n')
      writeFileSync(nowPath, content, 'utf-8')

      await consolidateNow({ nowPath })
      const afterFirstConsolidation = readFileSync(nowPath, 'utf-8')

      await consolidateNow({ nowPath })
      const afterSecondConsolidation = readFileSync(nowPath, 'utf-8')

      expect(afterSecondConsolidation).toBe(afterFirstConsolidation)
      expect(afterSecondConsolidation).toContain(
        '# Session: sess_idempotent - 2026-02-02 16:00 UTC',
      )
      expect(afterSecondConsolidation).not.toContain(
        '@decision: should be cleared once',
      )
      expect(afterSecondConsolidation).not.toContain(
        'body line should be cleared once',
      )
    })
  })

  test('clears NOW content after consolidation', async () => {
    await withTempCwd(async () => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })
      const nowPath = join(memoryDir, 'NOW-2026-02-02T16-00-00.md')
      const content = [
        '---',
        'session_id: sess_test',
        'timestamp_start: 2026-02-02T16:00:00.000Z',
        'timestamp_end: 2026-02-02T16:05:00.000Z',
        'duration_minutes: null',
        `project_path: ${process.cwd()}`,
        'tags: []',
        'parent_session: null',
        'related_tasks: []',
        'memory_type: NOW',
        '---',
        '',
        '# Session: sess_test - 2026-02-02 16:00 UTC',
        '',
        '@decision: should be cleared',
        '',
      ].join('\n')
      writeFileSync(nowPath, content, 'utf-8')

      await consolidateNow({ nowPath })

      const updated = readFileSync(nowPath, 'utf-8')
      expect(updated).toContain('# Session: sess_test - 2026-02-02 16:00 UTC')
      expect(updated).not.toContain('@decision: should be cleared')
    })
  })
})

describe('memory consolidation backups', () => {
  test('writes backup files before replacing outputs', async () => {
    await withTempCwd(async () => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })

      const nowPath = join(memoryDir, 'NOW-2026-02-02T16-00-00.md')
      const nowContent = [
        '---',
        'session_id: sess_test',
        'timestamp_start: 2026-02-02T16:00:00.000Z',
        'timestamp_end: 2026-02-02T16:05:00.000Z',
        'duration_minutes: null',
        `project_path: ${process.cwd()}`,
        'tags: [alpha]',
        'parent_session: null',
        'related_tasks: []',
        'memory_type: NOW',
        '---',
        '',
        '# Session: sess_test - 2026-02-02 16:00 UTC',
        '',
        '@decision: backup test',
        '',
      ].join('\n')
      writeFileSync(nowPath, nowContent, 'utf-8')

      const recentPath = join(memoryDir, 'RECENT.md')
      const memoryIndexPath = join(memoryDir, 'MEMORY.md')
      const memoryFilePath = join(memoryDir, 'MEMORY-2026-02-02.md')
      const logPath = join(memoryDir, 'consolidation.log')

      writeFileSync(recentPath, 'old recent', 'utf-8')
      writeFileSync(memoryIndexPath, 'old index', 'utf-8')
      writeFileSync(memoryFilePath, 'old memory', 'utf-8')
      writeFileSync(logPath, 'old log', 'utf-8')

      await consolidateNow({ nowPath })

      expect(readFileSync(`${recentPath}.bak`, 'utf-8')).toBe('old recent')
      expect(readFileSync(`${memoryIndexPath}.bak`, 'utf-8')).toBe('old index')
      expect(readFileSync(`${memoryFilePath}.bak`, 'utf-8')).toBe('old memory')
      expect(readFileSync(`${logPath}.bak`, 'utf-8')).toBe('old log')
      expect(readFileSync(`${nowPath}.bak`, 'utf-8')).toBe(nowContent)
    })
  })
})
