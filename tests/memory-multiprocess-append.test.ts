import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('multi-process memory append', () => {
  test('serializes independent CLI writers into unique canonical sequences', async () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-process-append-'))
    roots.push(root)
    const cli = join(import.meta.dir, '..', 'bin', 'continuum')
    expect(spawnSync('bun', ['run', cli, '--cwd', root, 'init']).status).toBe(0)

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        run('bun', [
          'run',
          cli,
          '--cwd',
          root,
          'memory',
          'append',
          'agent',
          `process-${index}`,
        ]),
      ),
    )
    expect(results.every((result) => result.code === 0)).toBe(true)

    const sqlite = new Database(join(root, '.continuum', 'continuum.db'))
    const rows = sqlite
      .query(
        'SELECT sequence, content FROM memory_journal_entries ORDER BY sequence',
      )
      .all() as Array<{ sequence: number; content: string }>
    sqlite.close()
    expect(rows.map((row) => row.sequence)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    )
    expect(new Set(rows.map((row) => row.content)).size).toBe(12)
    const now = readFileSync(
      join(root, '.continuum', 'memory', 'NOW.md'),
      'utf8',
    )
    for (let index = 0; index < 12; index++)
      expect(now).toContain(`process-${index}`)
  })

  test('keeps NOW and consolidation projections fresh across concurrent commands', async () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-process-projection-'))
    roots.push(root)
    const cli = join(import.meta.dir, '..', 'bin', 'continuum')
    const base = ['run', cli, '--cwd', root]
    expect(spawnSync('bun', [...base, 'init']).status).toBe(0)
    expect(
      spawnSync('bun', [
        ...base,
        'memory',
        'append',
        'agent',
        'consolidation-seed',
      ]).status,
    ).toBe(0)

    const results = await Promise.all([
      run('bun', [...base, 'memory', 'consolidate']),
      ...Array.from({ length: 8 }, (_, index) =>
        run('bun', [...base, 'memory', 'append', 'agent', `raced-${index}`]),
      ),
    ])
    expect(results.every((result) => result.code === 0)).toBe(true)

    const sqlite = new Database(join(root, '.continuum', 'continuum.db'))
    const boundary = (
      sqlite
        .query(
          "SELECT COALESCE(MAX(last_sequence), 0) value FROM memory_consolidations WHERE status='completed'",
        )
        .get() as { value: number }
    ).value
    const pending = sqlite
      .query(
        'SELECT content FROM memory_journal_entries WHERE sequence > ? ORDER BY sequence',
      )
      .all(boundary) as Array<{ content: string }>
    sqlite.close()
    const now = readFileSync(
      join(root, '.continuum', 'memory', 'NOW.md'),
      'utf8',
    )
    for (const row of pending) expect(now).toContain(row.content)
    expect(now.includes('consolidation-seed')).toBe(boundary === 0)
    if (boundary > 0) {
      expect(
        readFileSync(join(root, '.continuum', 'memory', 'MEMORY.md'), 'utf8'),
      ).toContain('## Sessions')
    }
  })
})

function run(
  command: string,
  args: string[],
): Promise<{ code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' })
    child.on('exit', (code) => resolve({ code }))
  })
}
