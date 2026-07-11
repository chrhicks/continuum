import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { appendMemory } from '../src/memory/application/append'
import { getDbClientByPath } from '../src/db/client'
import { makeJournalRepository } from '../src/memory/repository/journal-repository'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function paths(): { dbPath: string; nowPath: string } {
  const directory = mkdtempSync(join(tmpdir(), 'continuum-append-'))
  directories.push(directory)
  return {
    dbPath: join(directory, '.continuum', 'continuum.db'),
    nowPath: join(directory, '.continuum', 'memory', 'NOW.md'),
  }
}

describe('memory append application', () => {
  test('appends without a session and renders kinds in canonical order', async () => {
    const target = paths()
    for (const input of [
      { kind: 'user', content: 'request' },
      { kind: 'agent', content: 'response' },
      { kind: 'tool', content: 'bash - checked' },
    ]) {
      await Effect.runPromise(appendMemory({ ...target, input }))
    }

    const content = readFileSync(target.nowPath, 'utf8')
    expect(content).toContain('generated: true')
    expect(content.indexOf('## User: request')).toBeLessThan(
      content.indexOf('## Agent: response'),
    )
    expect(content.indexOf('## Agent: response')).toBeLessThan(
      content.indexOf('[Tool: bash - checked]'),
    )
  })

  test('is idempotent and regenerates a deleted projection', async () => {
    const target = paths()
    const input = {
      kind: 'user',
      content: 'once',
      idempotencyKey: 'operation-1',
    }
    const first = await Effect.runPromise(appendMemory({ ...target, input }))
    unlinkSync(target.nowPath)
    const retry = await Effect.runPromise(appendMemory({ ...target, input }))

    expect(retry.entry).toEqual(first.entry)
    expect(retry.projection.stale).toBe(false)
    expect(readFileSync(target.nowPath, 'utf8')).toContain('## User: once')
    const repository = makeJournalRepository(getDbClientByPath(target.dbPath))
    expect(await Effect.runPromise(repository.listPending())).toHaveLength(1)
  })

  test('reports stale projection after the row commits', async () => {
    const target = paths()
    const result = await Effect.runPromise(
      appendMemory({
        ...target,
        input: { kind: 'agent', content: 'durable' },
        publish: () => {
          throw new Error('disk full')
        },
      }),
    )

    expect(result.projection.stale).toBe(true)
    const db = new Database(target.dbPath)
    expect(
      db.query('SELECT content FROM memory_journal_entries').get(),
    ).toEqual({ content: 'durable' })
    db.close()
  })
})
