import { describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { importOpencodeRecall } from '../src/memory/recall-import'

const SUMMARY_CONTENT = [
  '---',
  'source: opencode',
  'session_id: ses_test',
  'project_id: proj_test',
  'directory: /tmp/project',
  'slug: test-session',
  'title: Test Session',
  'created_at: 2026-02-10T10:00:00.000Z',
  'updated_at: 2026-02-10T10:30:00.000Z',
  'summary_model: test',
  'summary_chunks: 1',
  'summary_max_chars: 1000',
  'summary_max_lines: 200',
  'summary_generated_at: 2026-02-10T10:31:00.000Z',
  'summary_keyword_total: 0',
  '---',
  '',
  '# Session Summary: Test Session',
  '',
  '## Focus',
  '',
  'Implement recall import flow.',
  '',
  '## Decisions',
  '',
  '- Use consolidate pipeline',
  '- Add CLI command',
  '',
  '## Discoveries',
  '',
  '- Summary files are markdown',
  '',
  '## Patterns',
  '',
  '- none',
  '',
  '## Tasks',
  '',
  '- tkt_abc123',
  '',
  '## Files',
  '',
  '- src/memory/recall-import.ts',
  '- src/cli/commands/memory.ts',
  '',
  '## Keywords',
  '',
  '- commands: `memory recall import`',
  '',
  '## Blockers',
  '',
  '- none',
  '',
  '## Open Questions',
  '',
  '- none',
  '',
  '## Next Steps',
  '',
  '- Write tests',
  '',
  '## Confidence (0.72)',
  '',
].join('\n')

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

describe('recall import', () => {
  test('imports opencode summaries into memory files', async () => {
    await withTempCwd(async () => {
      const recallDir = join(process.cwd(), '.continuum', 'recall', 'opencode')
      mkdirSync(recallDir, { recursive: true })
      const summaryPath = join(
        recallDir,
        'OPENCODE-SUMMARY-2026-02-10T10-00-00-ses_test.md',
      )
      writeFileSync(summaryPath, SUMMARY_CONTENT, 'utf-8')

      const result = await importOpencodeRecall()

      expect(result.imported).toBe(1)

      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      const recent = readFileSync(join(memoryDir, 'RECENT.md'), 'utf-8')
      expect(recent).toContain('Session 2026-02-10 10:00 (30m)')
      // With the mechanical fallback, decisions from @decision: markers are captured
      expect(recent).toContain('Use consolidate pipeline')
      expect(recent).toContain('**Decisions**:')

      const memoryFile = readFileSync(
        join(memoryDir, 'MEMORY-2026-02-10.md'),
        'utf-8',
      )
      expect(memoryFile).toContain('Session 2026-02-10 10:00 UTC (ses_test)')
      expect(memoryFile).toContain('**Decisions**:')
      expect(memoryFile).toContain('Use consolidate pipeline')
    })
  })

  test('skips already imported sessions', async () => {
    await withTempCwd(async () => {
      const recallDir = join(process.cwd(), '.continuum', 'recall', 'opencode')
      mkdirSync(recallDir, { recursive: true })
      const summaryPath = join(
        recallDir,
        'OPENCODE-SUMMARY-2026-02-10T10-00-00-ses_test.md',
      )
      writeFileSync(summaryPath, SUMMARY_CONTENT, 'utf-8')

      await importOpencodeRecall()

      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      const memoryPath = join(memoryDir, 'MEMORY-2026-02-10.md')
      const before = readFileSync(memoryPath, 'utf-8')
      const result = await importOpencodeRecall()
      const after = readFileSync(memoryPath, 'utf-8')

      expect(result.skippedExisting).toBe(1)
      expect(after).toBe(before)
    })
  })
})
