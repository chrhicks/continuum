import { isValidTaskType } from '../../../sdk'
import type {
  TaskGraphQuery,
  TaskStatus,
  TaskStepStatus,
  TaskType,
} from '../../../sdk/types'
import { parsePositiveInteger } from '../shared'

export type TaskListOptionsInput = {
  status?: string
  type?: string
  parent?: string
  includeDeleted?: boolean
  cursor?: string
  limit?: string
  sort?: string
  order?: string
}

export type ExpandOptions = {
  parent: boolean
  children: boolean
  blockers: boolean
}

export function parseTaskListOptions(options: TaskListOptionsInput) {
  return {
    status: options.status ? parseTaskStatus(options.status) : undefined,
    type: options.type ? parseTaskType(options.type) : undefined,
    parentId: options.parent ? options.parent.trim() : undefined,
    includeDeleted: options.includeDeleted ?? false,
    cursor: options.cursor,
    limit: options.limit ? parseLimit(options.limit) : undefined,
    sort: options.sort ? parseSort(options.sort) : undefined,
    order: options.order ? parseOrder(options.order) : undefined,
  }
}

export function parseTaskStatus(value: string): TaskStatus {
  const normalized = value.trim()
  const allowed: TaskStatus[] = [
    'open',
    'ready',
    'blocked',
    'completed',
    'cancelled',
    'deleted',
  ]
  if (allowed.includes(normalized as TaskStatus)) {
    return normalized as TaskStatus
  }
  throw new Error(
    'Invalid status. Use: open, ready, blocked, completed, cancelled, deleted.',
  )
}

export function parseTaskType(value: string): TaskType {
  const normalized = value.trim()
  if (isValidTaskType(normalized)) {
    return normalized as TaskType
  }
  throw new Error(
    'Invalid type. Use: epic, feature, bug, investigation, chore.',
  )
}

export function parseTaskStepStatus(value: string): TaskStepStatus {
  const normalized = value.trim()
  const allowed: TaskStepStatus[] = [
    'pending',
    'in_progress',
    'completed',
    'skipped',
  ]
  if (allowed.includes(normalized as TaskStepStatus)) {
    return normalized as TaskStepStatus
  }
  throw new Error(
    'Invalid step status. Use: pending, in_progress, completed, skipped.',
  )
}

export function parseTaskGraphQuery(value: string): TaskGraphQuery {
  const normalized = value.trim()
  const allowed: TaskGraphQuery[] = ['ancestors', 'descendants', 'children']
  if (allowed.includes(normalized as TaskGraphQuery)) {
    return normalized as TaskGraphQuery
  }
  throw new Error('Invalid query. Use: ancestors, descendants, children.')
}

export function parseExpandOptions(
  value?: string,
  tree?: boolean,
): ExpandOptions {
  const defaults: ExpandOptions = {
    parent: false,
    children: false,
    blockers: false,
  }
  if (tree) {
    return { ...defaults, children: true }
  }
  if (!value) return defaults
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const expanded = { ...defaults }
  if (items.includes('all')) {
    expanded.parent = true
    expanded.children = true
    expanded.blockers = true
    return expanded
  }
  for (const item of items) {
    if (item === 'parent') expanded.parent = true
    if (item === 'children') expanded.children = true
    if (item === 'blockers') expanded.blockers = true
  }
  return expanded
}

export function parseLimit(value: string): number {
  return parsePositiveInteger(value, 'Limit must be a positive integer.')
}

export function parseSort(
  value: string,
): 'createdAt' | 'updatedAt' | 'priority' {
  const normalized = value.trim()
  if (
    normalized === 'createdAt' ||
    normalized === 'updatedAt' ||
    normalized === 'priority'
  ) {
    return normalized
  }
  throw new Error('Invalid sort. Use: createdAt, updatedAt, or priority.')
}

export function parseOrder(value: string): 'asc' | 'desc' {
  const normalized = value.trim()
  if (normalized === 'asc' || normalized === 'desc') {
    return normalized
  }
  throw new Error('Invalid order. Use: asc or desc.')
}

export function parsePosition(value: string): number {
  const position = Number(value)
  if (!Number.isInteger(position)) {
    throw new Error('Position must be an integer.')
  }
  return position
}

export function parsePriority(value: string): number {
  const priority = Number(value)
  if (!Number.isInteger(priority)) {
    throw new Error('Priority must be an integer.')
  }
  return priority
}

export function parsePriorityValue(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'number' && Number.isInteger(value)) return value
  throw new Error('Priority must be an integer.')
}

export function parseNoteKind(value: string): 'discovery' | 'decision' {
  const normalized = value.trim()
  if (normalized === 'discovery' || normalized === 'decision') {
    return normalized
  }
  throw new Error('Invalid kind. Use: discovery or decision.')
}

export function parseNoteSource(value?: string): 'user' | 'agent' | 'system' {
  if (!value) return 'agent'
  const normalized = value.trim()
  if (
    normalized === 'user' ||
    normalized === 'agent' ||
    normalized === 'system'
  ) {
    return normalized
  }
  throw new Error('Invalid source. Use: user, agent, or system.')
}
