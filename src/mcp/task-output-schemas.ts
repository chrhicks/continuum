import { z } from 'zod'

const WorkspaceSchema = z.string().min(1)
const TaskStatusSchema = z.enum([
  'open',
  'ready',
  'blocked',
  'completed',
  'cancelled',
  'deleted',
])
const TaskTypeSchema = z.enum([
  'epic',
  'feature',
  'bug',
  'investigation',
  'chore',
])
const TaskStepStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'skipped',
])

const TaskNoteOutputSchema = z
  .object({
    id: z.string(),
    content: z.string(),
    source: z.enum(['user', 'agent', 'system']),
    rationale: z.string().nullable(),
    impact: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict()

const TaskStepOutputSchema = z
  .object({
    id: z.string(),
    status: TaskStepStatusSchema,
    position: z.number().int().nullable(),
    title: z.string(),
    description: z.string(),
    summary: z.string().nullable(),
    notes: z.string().nullable(),
  })
  .strict()

const TaskOutputSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    intent: z.string().nullable(),
    plan: z.string().nullable(),
    status: TaskStatusSchema,
    priority: z.number().int(),
    type: TaskTypeSchema,
    parentId: z.string().nullable(),
    blockedBy: z.array(z.string()),
    discoveries: z.array(TaskNoteOutputSchema),
    decisions: z.array(TaskNoteOutputSchema),
    steps: z.array(TaskStepOutputSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
    outcome: z.string().nullable(),
    completedAt: z.string().nullable(),
  })
  .strict()

const TaskMutationOutputSchema = z
  .object({ workspace: WorkspaceSchema, task: TaskOutputSchema })
  .strict()

const TaskListOutputSchema = z
  .object({
    workspace: WorkspaceSchema,
    tasks: z.array(TaskOutputSchema),
    nextCursor: z.string().optional(),
  })
  .strict()

const TaskGetOutputSchema = z
  .object({
    workspace: WorkspaceSchema,
    task: TaskOutputSchema,
    parent: TaskOutputSchema.nullable().optional(),
    children: z.array(TaskOutputSchema).optional(),
    blockers: z.array(TaskOutputSchema).optional(),
  })
  .strict()

const TaskValidationOutputSchema = z
  .object({
    workspace: WorkspaceSchema,
    id: z.string(),
    transition: z.enum(['open', 'ready', 'blocked', 'completed', 'cancelled']),
    valid: z.boolean(),
    missingFields: z.array(z.string()),
    openBlockers: z.array(z.string()),
  })
  .strict()

const TaskGraphOutputSchema = z
  .object({
    workspace: WorkspaceSchema,
    id: z.string(),
    query: z.enum(['ancestors', 'descendants', 'children']),
    taskIds: z.array(z.string()),
  })
  .strict()

const TaskDeleteOutputSchema = z
  .object({
    workspace: WorkspaceSchema,
    deleted: z.literal(true),
    id: z.string(),
  })
  .strict()

const TaskStepsListOutputSchema = z
  .object({
    workspace: WorkspaceSchema,
    id: z.string(),
    steps: z.array(TaskStepOutputSchema),
  })
  .strict()

const TaskStepCompleteOutputSchema = TaskMutationOutputSchema.extend({
  warnings: z.array(z.string()).optional(),
}).strict()

const InitOutputSchema = z
  .object({
    workspace: WorkspaceSchema,
    dbPath: z.string(),
    created: z.boolean(),
    initialized: z.boolean(),
  })
  .strict()

const RuntimeOutputSchema = z
  .object({
    storageGeneration: z.string(),
    workspace: WorkspaceSchema,
    entrypoint: z.string(),
    home: z.string(),
    dataHome: z.string(),
    database: z.string(),
  })
  .strict()

export function taskMutationOutputSchema(): typeof TaskMutationOutputSchema {
  return TaskMutationOutputSchema
}

export function taskListOutputSchema(): typeof TaskListOutputSchema {
  return TaskListOutputSchema
}

export function taskGetOutputSchema(): typeof TaskGetOutputSchema {
  return TaskGetOutputSchema
}

export function taskValidationOutputSchema(): typeof TaskValidationOutputSchema {
  return TaskValidationOutputSchema
}

export function taskGraphOutputSchema(): typeof TaskGraphOutputSchema {
  return TaskGraphOutputSchema
}

export function taskDeleteOutputSchema(): typeof TaskDeleteOutputSchema {
  return TaskDeleteOutputSchema
}

export function taskStepsListOutputSchema(): typeof TaskStepsListOutputSchema {
  return TaskStepsListOutputSchema
}

export function taskStepCompleteOutputSchema(): typeof TaskStepCompleteOutputSchema {
  return TaskStepCompleteOutputSchema
}

export function initOutputSchema(): typeof InitOutputSchema {
  return InitOutputSchema
}

export function runtimeOutputSchema(): typeof RuntimeOutputSchema {
  return RuntimeOutputSchema
}
