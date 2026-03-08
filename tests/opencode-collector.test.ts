import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { collectOpencodeRecords } from '../src/memory/collectors/opencode'
import { createDbMemoryStateRepository } from '../src/memory/state/db-repository'

async function withTempDir(
  run: (root: string) => Promise<void> | void,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'continuum-opencode-collect-'))
  try {
    await run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('collectOpencodeRecords', () => {
  test('collects OpenCode sessions into normalized records and checkpoints', async () => {
    await withTempDir(async (root) => {
      const repoRoot = join(root, 'repo')
      const dbPath = join(root, 'opencode.db')
      const outDir = join(repoRoot, '.continuum', 'recall', 'opencode')
      seedOpencodeDb(dbPath, repoRoot)

      const checkpointDbPath = join(repoRoot, '.continuum', 'continuum.db')
      const result = await collectOpencodeRecords(
        {
          repoPath: repoRoot,
          dbPath,
          outDir,
          summarize: false,
        },
        {
          stateRepository: createDbMemoryStateRepository({
            dbPath: checkpointDbPath,
          }),
        },
      )

      expect(result.sessionsProcessed).toBe(1)
      expect(result.records).toHaveLength(1)
      expect(result.records[0]?.source).toBe('opencode')
      expect(result.artifacts.normalized).toHaveLength(1)
      expect(result.artifacts.summaries).toHaveLength(0)
      expect(existsSync(result.artifacts.normalized[0]!)).toBe(true)
      const repository = createDbMemoryStateRepository({
        dbPath: checkpointDbPath,
      })
      expect(repository.listCheckpoints()).toHaveLength(1)
    })
  })

  test('generates summary artifacts and summary records when summarization is enabled', async () => {
    await withTempDir(async (root) => {
      const repoRoot = join(root, 'repo')
      const dbPath = join(root, 'opencode.db')
      const outDir = join(repoRoot, '.continuum', 'recall', 'opencode')
      seedOpencodeDb(dbPath, repoRoot)

      const result = await collectOpencodeRecords(
        {
          repoPath: repoRoot,
          dbPath,
          outDir,
          summarize: true,
          summaryModel: 'test-model',
          summaryApiKey: 'test-key',
        },
        {
          summarizeSession: async () => ({
            focus: 'Unify memory collection.',
            decisions: ['Promote OpenCode collection into the CLI.'],
            discoveries: [
              'The shared CollectedRecord model can represent summary artifacts.',
            ],
            patterns: [
              'Keep collectors source-specific and downstream stages source-agnostic.',
            ],
            tasks: ['tkt-test123'],
            files: ['src/memory/collectors/opencode.ts'],
            blockers: [],
            open_questions: [],
            next_steps: ['Wire the collector into the CLI.'],
            confidence: 'high',
          }),
        },
      )

      expect(result.records).toHaveLength(2)
      expect(result.artifacts.summaries).toHaveLength(1)
      expect(result.artifacts.summaryMeta).toHaveLength(1)
      const summaryContent = readFileSync(
        result.artifacts.summaries[0]!,
        'utf-8',
      )
      expect(summaryContent).toContain('## Focus')
      expect(summaryContent).toContain('Unify memory collection.')
      expect(summaryContent).toContain('## Next Steps')
    })
  })
})

function seedOpencodeDb(dbPath: string, repoRoot: string): void {
  const db = new Database(dbPath)
  const createdAt = Date.parse('2026-03-07T20:00:00.000Z')
  const updatedAt = Date.parse('2026-03-07T20:05:00.000Z')
  try {
    db.exec(`
      CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        parent_id TEXT,
        slug TEXT,
        directory TEXT,
        title TEXT,
        version TEXT,
        summary_additions INTEGER,
        summary_deletions INTEGER,
        summary_files INTEGER,
        time_created INTEGER,
        time_updated INTEGER
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        time_created INTEGER,
        time_updated INTEGER,
        data TEXT
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT,
        session_id TEXT,
        time_created INTEGER,
        time_updated INTEGER,
        data TEXT
      );
    `)

    db.query(
      'INSERT INTO project (id, worktree, time_created, time_updated) VALUES (?, ?, ?, ?)',
    ).run('proj_test', repoRoot, createdAt, updatedAt)
    db.query(
      `INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, summary_additions, summary_deletions, summary_files, time_created, time_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'ses_test',
      'proj_test',
      null,
      'memory-refactor',
      repoRoot,
      'Memory refactor',
      '1',
      0,
      0,
      0,
      createdAt,
      updatedAt,
    )
    db.query(
      'INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)',
    ).run(
      'msg_user',
      'ses_test',
      createdAt,
      createdAt,
      JSON.stringify({ role: 'user', time: { created: createdAt } }),
    )
    db.query(
      'INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)',
    ).run(
      'msg_agent',
      'ses_test',
      updatedAt,
      updatedAt,
      JSON.stringify({ role: 'assistant', time: { created: updatedAt } }),
    )
    db.query(
      'INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      'part_user',
      'msg_user',
      'ses_test',
      createdAt,
      createdAt,
      JSON.stringify({
        type: 'text',
        text: 'Please update src/memory/collectors/opencode.ts for task tkt-test123.',
        time: { start: createdAt, end: createdAt },
      }),
    )
    db.query(
      'INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      'part_agent',
      'msg_agent',
      'ses_test',
      updatedAt,
      updatedAt,
      JSON.stringify({
        type: 'text',
        text: 'Implemented changes in src/memory/collectors/opencode.ts and src/memory/types.ts.',
        time: { start: updatedAt, end: updatedAt },
      }),
    )
  } finally {
    db.close()
  }
}
