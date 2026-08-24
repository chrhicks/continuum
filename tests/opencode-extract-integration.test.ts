import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importCanonicalOpencodeRecall } from '../src/memory/application/recall-import'
import { extractOpencodeSessions } from '../src/memory/opencode/extract'
import { Effect, Redacted } from 'effect'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('real OpenCode SQLite extraction', () => {
  test('resolves a stale worktree and applies --after before --limit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-opencode-db-'))
    roots.push(root)
    const repoPath = join(root, 'renamed-repo')
    const dbPath = join(root, 'opencode.db')
    seedOpencodeDb(dbPath, repoPath)

    const extraction = extractOpencodeSessions({
      dbPath,
      repoPath,
      afterDate: new Date('2026-07-10T00:00:00.000Z'),
      limit: 1,
    })
    expect(extraction.project.id).toBe('project-stale')
    expect(extraction.sessions.map((item) => item.session.id)).toEqual([
      'session-newest',
    ])
    expect(extraction.sessions[0]?.messageBlocks[0]?.parts[0]?.text).toBe(
      'Evidence from session-newest',
    )

    const imported = await Effect.runPromise(
      importCanonicalOpencodeRecall({
        dbPath,
        repoPath,
        continuumDbPath: join(root, 'continuum.db'),
        afterDate: new Date('2026-07-10T00:00:00.000Z'),
        limit: 1,
        dryRun: true,
        summaryConfig: {
          apiUrl: 'test',
          apiKey: Redacted.make('test'),
          model: 'test',
          maxTokens: 1,
          timeoutMs: 1,
          maxChars: 1000,
          maxLines: 100,
          mergeMaxEstTokens: 1000,
        },
      }),
    )
    expect(imported.totalSessions).toBe(1)
    expect(imported.importedSessions).toEqual(['session-newest'])
  })
})

function seedOpencodeDb(dbPath: string, currentRepo: string): void {
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT);
    CREATE TABLE session (
      id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, slug TEXT,
      directory TEXT, title TEXT, version TEXT, summary_additions INTEGER,
      summary_deletions INTEGER, summary_files INTEGER, time_created INTEGER,
      time_updated INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER,
      time_updated INTEGER, data TEXT
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT,
      time_created INTEGER, time_updated INTEGER, data TEXT
    );
  `)
  db.query('INSERT INTO project (id, worktree) VALUES (?, ?)').run(
    'project-stale',
    join(currentRepo, '..', 'old-repo'),
  )
  insertSession(db, currentRepo, 'session-old', '2026-07-01T00:00:00.000Z')
  insertSession(db, currentRepo, 'session-new', '2026-07-10T00:00:00.000Z')
  insertSession(db, currentRepo, 'session-newest', '2026-07-11T00:00:00.000Z')
  db.close()
}

function insertSession(
  db: Database,
  directory: string,
  sessionId: string,
  timestamp: string,
): void {
  const time = Date.parse(timestamp)
  db.query(
    `INSERT INTO session
     (id, project_id, slug, directory, title, version, summary_additions,
      summary_deletions, summary_files, time_created, time_updated)
     VALUES (?, 'project-stale', ?, ?, ?, '1', 0, 0, 0, ?, ?)`,
  ).run(sessionId, sessionId, directory, sessionId, time, time)
  const messageId = `message-${sessionId}`
  db.query(
    `INSERT INTO message (id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    messageId,
    sessionId,
    time,
    time,
    JSON.stringify({ role: 'user', time: { created: time } }),
  )
  db.query(
    `INSERT INTO part
     (id, message_id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    `part-${sessionId}`,
    messageId,
    sessionId,
    time,
    time,
    JSON.stringify({ type: 'text', text: `Evidence from ${sessionId}` }),
  )
}
