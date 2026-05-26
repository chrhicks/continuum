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

import { repairRecent } from '../src/memory/repair-recent'

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

describe('repairRecent', () => {
  test('rebuilds RECENT from MEMORY files and preserves known durations', async () => {
    await withTempCwd(async () => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })

      writeFileSync(
        join(memoryDir, 'RECENT.md'),
        [
          '# RECENT - Last 3 Sessions',
          '',
          '## Session 2026-02-01 09:00 (5m)',
          '',
          '**Source**: NOW session',
          '',
          'Existing recent entry.',
          '**Link**: [Full details](MEMORY-2026-02-01.md#session-known)',
        ].join('\n') + '\n',
        'utf-8',
      )

      writeFileSync(
        join(memoryDir, 'MEMORY-2026-02-10.md'),
        [
          '---',
          'source_sessions: [sess_known, ses_test]',
          'tags: []',
          '---',
          '',
          '# Consolidated Memory',
          '',
          '## Session 2026-02-01 09:00 UTC (sess_known)',
          '<a name="session-known"></a>',
          '',
          '**Source**: NOW session',
          '',
          'Existing recent entry.',
          '',
          '## Recall Import 2026-02-10 10:00 UTC (ses_test)',
          '<a name="session-missing"></a>',
          '',
          '**Source**: Imported OpenCode summary',
          '',
          'Implement recall import flow.',
          '',
          '**Decisions**:',
          '- Use consolidate pipeline',
          '',
          '**Next steps**:',
          '- Write tests',
          '',
          '**Files**: `src/memory/recall-import.ts`',
          '',
        ].join('\n'),
        'utf-8',
      )

      const result = repairRecent()
      const recent = readFileSync(join(memoryDir, 'RECENT.md'), 'utf-8')

      expect(result.rebuiltEntries).toBe(2)
      expect(result.reusedDurations).toBe(1)
      expect(result.unknownDurations).toBe(1)
      expect(recent).toContain('## Session 2026-02-01 09:00 (5m)')
      expect(recent).toContain('## Recall Import 2026-02-10 10:00 (unknown)')
      expect(recent).toContain('Use consolidate pipeline')
      expect(recent).toContain('Write tests')
      expect(recent).not.toContain('**Files**:')
    })
  })

  test('dry run previews RECENT rebuild without writing files', async () => {
    await withTempCwd(async () => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })
      const recentPath = join(memoryDir, 'RECENT.md')

      writeFileSync(recentPath, 'original recent\n', 'utf-8')
      writeFileSync(
        join(memoryDir, 'MEMORY-2026-02-10.md'),
        [
          '---',
          'source_sessions: [ses_test]',
          'tags: []',
          '---',
          '',
          '# Consolidated Memory',
          '',
          '## Recall Import 2026-02-10 10:00 UTC (ses_test)',
          '<a name="session-missing"></a>',
          '',
          '**Source**: Imported OpenCode summary',
          '',
          'Implement recall import flow.',
        ].join('\n'),
        'utf-8',
      )

      const result = repairRecent({ dryRun: true })

      expect(result.dryRun).toBe(true)
      expect(result.updatedRecent).toContain('Recall Import 2026-02-10 10:00')
      expect(readFileSync(recentPath, 'utf-8')).toBe('original recent\n')
    })
  })
})
