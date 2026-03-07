import { getWorkspaceContext } from '../paths'
import { normalizeTaskRecord } from './index'
import type { Task, TaskStatus } from '../../task/types'
import type { CollectedRecord, MemorySummary } from '../types'
import {
  get_task_for_directory,
  list_tasks_by_statuses_for_directory,
} from '../../task/tasks.service'
import { createCheckpointInput } from '../state/file-repository'
import type { MemoryCheckpoint } from '../state/types'
import type { MemoryStateRepository } from '../state/repository'

const DEFAULT_TASK_STATUSES: TaskStatus[] = [
  'open',
  'ready',
  'blocked',
  'completed',
  'cancelled',
]

export type TaskCollectionOptions = {
  directory?: string | null
  taskId?: string | null
  statuses?: TaskStatus[] | null
  limit?: number | null
}

export type TaskCollectionItem = {
  task: Task
  record: CollectedRecord
  summary: MemorySummary
}

export type TaskCollectionResult = {
  directory: string
  tasksExamined: number
  items: TaskCollectionItem[]
  records: CollectedRecord[]
  skippedUnchanged: number
  checkpoint: MemoryCheckpoint | null
}

export async function collectTaskRecords(
  options: TaskCollectionOptions = {},
  dependencies: { stateRepository?: MemoryStateRepository } = {},
): Promise<TaskCollectionResult> {
  const workspace = getWorkspaceContext()
  const directory = options.directory ?? workspace.workspaceRoot
  const statuses = options.statuses?.length
    ? options.statuses
    : DEFAULT_TASK_STATUSES

  const tasks = options.taskId
    ? await loadOneTask(directory, options.taskId)
    : await list_tasks_by_statuses_for_directory(directory, { statuses })

  const sortedTasks = tasks.slice().sort((left, right) => {
    const updatedDelta =
      Date.parse(right.updated_at) - Date.parse(left.updated_at)
    if (updatedDelta !== 0) {
      return updatedDelta
    }
    return left.id.localeCompare(right.id)
  })
  const limitedTasks =
    options.limit && options.limit > 0
      ? sortedTasks.slice(0, options.limit)
      : sortedTasks

  const checkpoint = dependencies.stateRepository?.getCheckpoint(
    'task',
    `workspace:${directory}`,
  )
  const existingFingerprints = readTaskFingerprintMap(checkpoint)

  const items: TaskCollectionItem[] = []
  let skippedUnchanged = 0
  const nextFingerprints: Record<string, string> = { ...existingFingerprints }

  for (const task of limitedTasks) {
    const record = normalizeTaskRecord(task, { workspaceRoot: directory })
    nextFingerprints[task.id] = record.fingerprint
    if (existingFingerprints[task.id] === record.fingerprint) {
      skippedUnchanged += 1
      continue
    }
    items.push({ task, record, summary: buildTaskMemorySummary(task, record) })
  }

  const nextCheckpoint = dependencies.stateRepository
    ? dependencies.stateRepository.putCheckpoint(
        createCheckpointInput({
          source: 'task',
          scope: `workspace:${directory}`,
          cursor: limitedTasks[0]?.updated_at ?? null,
          fingerprint: limitedTasks[0]?.id ?? null,
          recordCount: limitedTasks.length,
          metadata: {
            taskFingerprints: nextFingerprints,
            taskCount: limitedTasks.length,
          },
        }),
      )
    : null

  return {
    directory,
    tasksExamined: limitedTasks.length,
    items,
    records: items.map((item) => item.record),
    skippedUnchanged,
    checkpoint: nextCheckpoint,
  }
}

async function loadOneTask(directory: string, taskId: string): Promise<Task[]> {
  const task = await get_task_for_directory(directory, taskId)
  return task ? [task] : []
}

function buildTaskMemorySummary(
  task: Task,
  record: CollectedRecord,
): MemorySummary {
  const narrative = task.intent
    ? `${task.title}: ${task.intent}`
    : task.description
      ? `${task.title}: ${task.description}`
      : `${task.title} (${task.status})`

  return {
    narrative,
    decisions: task.decisions.map((decision) =>
      decision.rationale
        ? `${decision.content} because ${decision.rationale}`
        : decision.content,
    ),
    discoveries: task.discoveries.map((discovery) => discovery.content),
    patterns: [],
    whatWorked: [],
    whatFailed: [],
    blockers: task.blocked_by.map((blocker) => `Blocked by ${blocker}`),
    openQuestions: [],
    nextSteps: task.steps
      .filter(
        (step) => step.status === 'pending' || step.status === 'in_progress',
      )
      .map((step) => step.title ?? step.description ?? '')
      .filter((value) => value.trim().length > 0),
    tasks: Array.from(new Set([task.id, ...task.blocked_by])).sort((a, b) =>
      a.localeCompare(b),
    ),
    files: record.references.filePaths,
    confidence:
      task.status === 'completed'
        ? 'high'
        : task.status === 'cancelled'
          ? 'low'
          : 'medium',
  }
}

function readTaskFingerprintMap(
  checkpoint: MemoryCheckpoint | null | undefined,
): Record<string, string> {
  const raw = checkpoint?.metadata?.taskFingerprints
  if (!raw || typeof raw !== 'object') {
    return {}
  }
  const map: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.trim().length === 0 || typeof value !== 'string') {
      continue
    }
    map[key] = value
  }
  return map
}
