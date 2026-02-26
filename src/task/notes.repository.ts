import { eq } from 'drizzle-orm'
import type { DbClient } from '../db/client'
import { tasks } from '../db/schema'
import { get_task, require_task } from './tasks.repository'
import type {
  AddDecisionInput,
  AddDiscoveryInput,
  Decision,
  Discovery,
  Task,
} from './types'

export async function add_discovery(
  db: DbClient,
  input: AddDiscoveryInput,
): Promise<Task> {
  const task = await require_task(db, input.task_id)

  const maxId = task.discoveries.reduce((max, d) => Math.max(max, d.id), 0)
  const discovery: Discovery = {
    id: maxId + 1,
    content: input.content,
    source: input.source ?? 'system',
    impact: input.impact ?? null,
    created_at: new Date().toISOString(),
  }

  const discoveries = [...task.discoveries, discovery]

  await db
    .update(tasks)
    .set({
      discoveries: JSON.stringify(discoveries),
      updated_at: new Date().toISOString(),
    })
    .where(eq(tasks.id, input.task_id))
    .run()

  return (await get_task(db, input.task_id))!
}

export async function add_decision(
  db: DbClient,
  input: AddDecisionInput,
): Promise<Task> {
  const task = await require_task(db, input.task_id)

  const maxId = task.decisions.reduce((max, d) => Math.max(max, d.id), 0)
  const decision: Decision = {
    id: maxId + 1,
    content: input.content,
    rationale: input.rationale ?? null,
    source: input.source ?? 'system',
    impact: input.impact ?? null,
    created_at: new Date().toISOString(),
  }

  const decisions = [...task.decisions, decision]

  await db
    .update(tasks)
    .set({
      decisions: JSON.stringify(decisions),
      updated_at: new Date().toISOString(),
    })
    .where(eq(tasks.id, input.task_id))
    .run()

  return (await get_task(db, input.task_id))!
}
