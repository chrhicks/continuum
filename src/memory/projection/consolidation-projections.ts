import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { MemoryConfig } from '../config'
import type { JournalEntry } from '../domain/journal-entry'
import { writeFilesAtomically } from '../consolidate-io'
import { renderConsolidationArtifacts } from '../consolidation/render'
import type { PreparedConsolidationInput } from '../domain/projection-input'
import type { CompletedConsolidation } from '../repository/consolidation-repository'
import { renderNowProjection } from './now-projection'

export type ProjectionModel = {
  consolidation: CompletedConsolidation
  entries: readonly JournalEntry[]
}

export function publishMemoryProjections(options: {
  memoryDir: string
  pending: readonly JournalEntry[]
  completed: readonly ProjectionModel[]
  config: MemoryConfig
}): void {
  mkdirSync(options.memoryDir, { recursive: true })
  let recent: string | null = null
  let index: string | null = null
  const daily = new Map<string, string>()

  for (const model of options.completed) {
    const input = toPreparedInput(model)
    const date = input.timestampStart.toISOString().slice(0, 10)
    const artifacts = renderConsolidationArtifacts({
      input,
      summary: model.consolidation.summary,
      config: options.config,
      existing: {
        recent,
        index,
        memory: daily.get(date) ?? null,
      },
    })
    recent = artifacts.updatedRecent
    index = artifacts.updatedIndex
    daily.set(date, artifacts.updatedMemory)
  }

  writeFilesAtomically([
    {
      path: join(options.memoryDir, 'NOW.md'),
      content: renderNowProjection(options.pending),
    },
    {
      path: join(options.memoryDir, 'RECENT.md'),
      content: recent ?? emptyRecent(),
    },
    ...Array.from(daily, ([date, content]) => ({
      path: join(options.memoryDir, `MEMORY-${date}.md`),
      content,
    })),
    {
      path: join(options.memoryDir, 'MEMORY.md'),
      content: index ?? emptyIndex(),
    },
  ])
}

function toPreparedInput(model: ProjectionModel): PreparedConsolidationInput {
  const first = model.entries[0]
  const last = model.entries.at(-1)
  const start = new Date(first?.createdAt ?? model.consolidation.completedAt)
  const end = new Date(last?.createdAt ?? model.consolidation.completedAt)
  return {
    record: {
      id: model.consolidation.id,
      source: 'now',
      kind: 'session',
      externalId: model.consolidation.id,
      projectId: null,
      workspaceRoot: null,
      title: null,
      body: model.entries.map((entry) => entry.content).join('\n'),
      createdAt: start.toISOString(),
      updatedAt: end.toISOString(),
      references: { tags: [], taskIds: [], filePaths: [] },
      metadata: {},
      fingerprint: model.consolidation.id,
    },
    sourcePath: join(
      'SQLite',
      `${model.consolidation.firstSequence}-${model.consolidation.lastSequence}`,
    ),
    sessionId: model.consolidation.id,
    timestampStart: start,
    timestampEnd: end,
    durationMinutes: Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 60000),
    ),
    tags: [],
    precomputedSummary: model.consolidation.summary,
    clearSourceAfterPersist: false,
  }
}

function emptyRecent(): string {
  return '---\nmemory_type: RECENT\ngenerated: true\nauthoritative: false\n---\n\n# Recent Memory\n'
}

function emptyIndex(): string {
  return '---\nmemory_type: MEMORY_INDEX\ngenerated: true\nauthoritative: false\n---\n\n# Long-term Memory Index\n'
}
