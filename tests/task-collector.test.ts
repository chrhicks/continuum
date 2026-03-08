import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import continuum from '../src/sdk'
import { collectTaskRecords } from '../src/memory/collectors/task'
import { createDbMemoryStateRepository } from '../src/memory/state/db-repository'

async function withTempCwd(run: () => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'continuum-task-collect-'))
  const previous = process.cwd()
  try {
    process.chdir(root)
    await run()
  } finally {
    process.chdir(previous)
    rmSync(root, { recursive: true, force: true })
  }
}

describe('collectTaskRecords', () => {
  test('collects task records and skips unchanged tasks via checkpoint state', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()
      const task = await continuum.task.create({
        title: 'Collect task memory',
        type: 'feature',
        intent: 'Feed task history into memory search.',
        description: 'Update src/memory/collectors/task.ts and README.md.',
        plan: '1. Add collector\n2. Wire CLI',
      })
      await continuum.task.steps.add(task.id, {
        steps: [
          {
            title: 'Add collector',
            description: 'Implement task collector',
            status: 'pending',
            position: 1,
          },
        ],
      })
      await continuum.task.notes.add(task.id, {
        kind: 'decision',
        content: 'Use task records as first-class memory sources.',
        rationale: 'the retrieval layer should not depend on NOW flush hacks',
        source: 'agent',
      })
      await continuum.task.notes.add(task.id, {
        kind: 'discovery',
        content: 'Task descriptions often reference files directly.',
        source: 'agent',
      })

      const repository = createDbMemoryStateRepository({
        dbPath: join(process.cwd(), '.continuum', 'continuum.db'),
      })

      const first = await collectTaskRecords(
        { directory: process.cwd() },
        { stateRepository: repository },
      )
      expect(first.tasksExamined).toBe(1)
      expect(first.records).toHaveLength(1)
      expect(first.records[0]?.references.filePaths).toEqual([
        'README.md',
        'src/memory/collectors/task.ts',
      ])
      expect(first.items[0]?.summary.decisions).toContain(
        'Use task records as first-class memory sources. because the retrieval layer should not depend on NOW flush hacks',
      )

      const second = await collectTaskRecords(
        { directory: process.cwd() },
        { stateRepository: repository },
      )
      expect(second.records).toHaveLength(0)
      expect(second.skippedUnchanged).toBe(1)

      await continuum.task.update(task.id, {
        plan: '1. Add collector\n2. Wire CLI\n3. Add tests',
      })

      const third = await collectTaskRecords(
        { directory: process.cwd() },
        { stateRepository: repository },
      )
      expect(third.records).toHaveLength(1)
      expect(third.skippedUnchanged).toBe(0)
      expect(third.checkpoint).not.toBeNull()
      expect(
        existsSync(join(process.cwd(), '.continuum', 'continuum.db')),
      ).toBe(true)
      expect(
        repository.getCheckpoint('task', `workspace:${process.cwd()}`)
          ?.metadata,
      ).toBeDefined()
    })
  })
})
