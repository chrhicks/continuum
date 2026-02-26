import type {
  create_task_for_directory,
  update_task_for_directory,
} from '../task/tasks.service'
import type { Decision, Discovery, Step, Task, TaskStatus } from '../task/types'
import type {
  CollectionPatch as SdkCollectionPatch,
  CreateTaskInput as SdkCreateTaskInput,
  Task as SdkTask,
  TaskDecision as SdkTaskDecision,
  TaskDiscovery as SdkTaskDiscovery,
  TaskNote as SdkTaskNote,
  TaskNoteInput as SdkTaskNoteInput,
  TaskStatus as SdkTaskStatus,
  TaskStep as SdkTaskStep,
  TaskStepInput as SdkTaskStepInput,
  TaskType as SdkTaskType,
  UpdateTaskInput as SdkUpdateTaskInput,
} from './types'

type ServiceCreateTaskInput = Parameters<typeof create_task_for_directory>[1]
type ServiceUpdateTaskInput = Parameters<typeof update_task_for_directory>[2]

function map_step(step: Step): SdkTaskStep {
  return {
    id: String(step.id),
    status: step.status,
    position: step.position ?? null,
    title: step.title ?? '',
    description: step.description ?? step.details ?? '',
    summary: step.summary ?? null,
    notes: step.notes ?? null,
  }
}

function map_note(note: Discovery | Decision): SdkTaskNote {
  return {
    id: String(note.id),
    content: note.content,
    source: note.source,
    rationale: 'rationale' in note ? (note.rationale ?? null) : null,
    impact: note.impact ?? null,
    createdAt: note.created_at,
    updatedAt: note.created_at,
  }
}

export function map_task(task: Task): SdkTask {
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? '',
    intent: task.intent ?? null,
    plan: task.plan ?? null,
    status: task.status as SdkTaskStatus,
    priority: task.priority,
    type: task.type,
    parentId: task.parent_id,
    blockedBy: task.blocked_by,
    discoveries: task.discoveries.map(map_note),
    decisions: task.decisions.map(map_note),
    steps: task.steps.map(map_step),
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    outcome: task.outcome ?? null,
    completedAt: task.completed_at ?? null,
  }
}

function map_status(value?: SdkTaskStatus): TaskStatus | undefined {
  if (!value || value === 'deleted') return undefined
  return value as TaskStatus
}

export function map_list_status(
  value?: SdkTaskStatus,
): TaskStatus | 'deleted' | undefined {
  return value as TaskStatus | 'deleted' | undefined
}

export function map_create_input(
  input: SdkCreateTaskInput,
): ServiceCreateTaskInput {
  return {
    title: input.title,
    type: input.type,
    status: map_status(input.status),
    priority: input.priority ?? null,
    intent: input.intent ?? null,
    description: input.description,
    plan: input.plan ?? null,
    parent_id: input.parentId ?? null,
    blocked_by: input.blockedBy ?? null,
  }
}

export function map_update_input(
  input: SdkUpdateTaskInput,
): ServiceUpdateTaskInput {
  return {
    title: input.title,
    description: input.description,
    intent: input.intent,
    plan: input.plan,
    status: map_status(input.status),
    priority: input.priority === undefined ? undefined : input.priority,
    type: input.type,
    parent_id: input.parentId === undefined ? undefined : input.parentId,
    blocked_by: input.blockedBy === undefined ? undefined : input.blockedBy,
    steps: input.steps
      ? {
          add: input.steps.add?.map((step) => ({
            title: step.title,
            description: step.description,
            status: step.status,
            position: step.position,
            summary: step.summary ?? undefined,
            notes: step.notes ?? undefined,
          })),
          update: input.steps.update?.map((step) => ({
            id: step.id,
            title: step.title,
            description: step.description,
            status: step.status,
            position: step.position,
            summary: step.summary ?? undefined,
            notes: step.notes ?? undefined,
          })),
          delete: input.steps.delete,
        }
      : undefined,
    discoveries: input.discoveries
      ? {
          add: input.discoveries.add?.map((note) => ({
            content: note.content,
            source: note.source,
            rationale: note.rationale,
            impact: note.impact,
          })),
          update: input.discoveries.update?.map((note) => ({
            id: note.id,
            content: note.content,
            source: note.source,
            rationale: note.rationale,
            impact: note.impact,
          })),
          delete: input.discoveries.delete,
        }
      : undefined,
    decisions: input.decisions
      ? {
          add: input.decisions.add?.map((note) => ({
            content: note.content,
            source: note.source,
            rationale: note.rationale,
            impact: note.impact,
          })),
          update: input.decisions.update?.map((note) => ({
            id: note.id,
            content: note.content,
            source: note.source,
            rationale: note.rationale,
            impact: note.impact,
          })),
          delete: input.decisions.delete,
        }
      : undefined,
  }
}
