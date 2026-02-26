import { tasks } from '../db/schema'
import type {
  Decision,
  Discovery,
  Step,
  Task,
  TaskStatus,
  TaskType,
} from './types'

const DEFAULT_TASK_PRIORITY = 100

type TaskRow = typeof tasks.$inferSelect

export function normalize_priority(value?: number | null): number {
  if (value === null || value === undefined) return DEFAULT_TASK_PRIORITY
  return value
}

function parse_json_array<T>(
  value: string | null,
  defaultValue: T[] = [],
): T[] {
  if (!value) return defaultValue
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : defaultValue
  } catch {
    return defaultValue
  }
}

function parse_blocked_by(value: string | null): string[] {
  return parse_json_array<string>(value).filter(
    (item) => typeof item === 'string',
  )
}

function parse_steps(value: string | null): Step[] {
  const steps = parse_json_array<Step>(value)
  return steps.map((step) => ({
    id: step.id,
    title: step.title,
    description: step.description ?? step.details ?? '',
    position: step.position ?? 0,
    summary: step.summary,
    details: step.details,
    status: step.status ?? 'pending',
    notes: step.notes ?? null,
  }))
}

function parse_discoveries(value: string | null): Discovery[] {
  const discoveries = parse_json_array<Discovery>(value)
  return discoveries.map((discovery) => ({
    id: discovery.id,
    content: discovery.content,
    source: discovery.source ?? 'system',
    impact: discovery.impact ?? null,
    created_at: discovery.created_at,
  }))
}

function parse_decisions(value: string | null): Decision[] {
  const decisions = parse_json_array<Decision>(value)
  return decisions.map((decision) => ({
    id: decision.id,
    content: decision.content,
    rationale: decision.rationale ?? null,
    source: decision.source ?? 'system',
    impact: decision.impact ?? null,
    created_at: decision.created_at,
  }))
}

export function row_to_task(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    type: row.type as TaskType,
    status: row.status as TaskStatus | 'deleted',
    priority: normalize_priority(row.priority ?? undefined),
    intent: row.intent ?? null,
    description: row.description ?? null,
    plan: row.plan ?? null,
    steps: parse_steps(row.steps),
    current_step: row.current_step ?? null,
    discoveries: parse_discoveries(row.discoveries),
    decisions: parse_decisions(row.decisions),
    outcome: row.outcome ?? null,
    completed_at: row.completed_at ?? null,
    parent_id: row.parent_id ?? null,
    blocked_by: parse_blocked_by(row.blocked_by),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}
