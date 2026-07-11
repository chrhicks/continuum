import { z } from 'zod'
import type {
  CreateTaskInput,
  TaskStatus,
  TaskStep,
  TaskStepInput,
  TaskType,
  UpdateTaskInput,
} from '../sdk/types'

export function workspaceSchema(): z.ZodString {
  return z
    .string()
    .min(1)
    .describe('Absolute path inside the Continuum workspace')
}
export function idSchema(): z.ZodString {
  return z.string().min(1)
}
export function positiveIntegerSchema(): z.ZodNumber {
  return z.number().int().positive()
}
export function taskTypeSchema(): z.ZodType<TaskType> {
  return z.enum(['epic', 'feature', 'bug', 'investigation', 'chore'])
}
export function taskStatusSchema(): z.ZodType<Exclude<TaskStatus, 'deleted'>> {
  return z.enum(['open', 'ready', 'blocked', 'completed', 'cancelled'])
}
export function listTaskStatusSchema(): z.ZodType<TaskStatus> {
  return z.enum([
    'open',
    'ready',
    'blocked',
    'completed',
    'cancelled',
    'deleted',
  ])
}
export function stepStatusSchema(): z.ZodType<TaskStep['status']> {
  return z.enum(['pending', 'in_progress', 'completed', 'skipped'])
}

export function taskCreateSchema(): z.ZodType<CreateTaskInput> {
  return z.object({
    title: z.string().min(1),
    type: taskTypeSchema(),
    status: taskStatusSchema().optional(),
    priority: z.number().int().nullable().optional(),
    intent: z.string().nullable().optional(),
    description: z.string(),
    plan: z.string().nullable().optional(),
    parentId: z.string().nullable().optional(),
    blockedBy: z.array(z.string()).nullable().optional(),
  })
}

export function taskPatchSchema(): z.ZodType<UpdateTaskInput> {
  return z.object({
    title: z.string().min(1).optional(),
    type: taskTypeSchema().optional(),
    status: taskStatusSchema().optional(),
    priority: z.number().int().nullable().optional(),
    intent: z.string().nullable().optional(),
    description: z.string().optional(),
    plan: z.string().nullable().optional(),
    parentId: z.string().nullable().optional(),
    blockedBy: z.array(z.string()).nullable().optional(),
  })
}

export function taskStepSchema(): z.ZodType<TaskStepInput> {
  return z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    status: stepStatusSchema().optional(),
    position: z.number().int().nullable().optional(),
    summary: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
}

export function taskStepPatchSchema(): z.ZodType<Partial<TaskStep>> {
  return z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    status: stepStatusSchema().optional(),
    position: z.number().int().nullable().optional(),
    summary: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
}
