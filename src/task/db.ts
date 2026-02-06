import { Database } from 'bun:sqlite'
import { randomId } from './db.utils'
import { init_status } from './util'
import { ContinuumError } from './error'
import { getMigrations } from './migration'

export type TaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'
export type TaskType = 'epic' | 'feature' | 'bug' | 'investigation' | 'chore'
export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped'

export interface Step {
  id: number
  title?: string
  summary?: string
  details?: string
  status: StepStatus
  notes: string | null
}

export interface Discovery {
  id: number
  content: string
  created_at: string
}

export interface Decision {
  id: number
  content: string
  rationale: string | null
  created_at: string
}

export interface Task {
  id: string
  title: string
  type: TaskType
  status: TaskStatus | 'deleted'
  intent: string | null
  description: string | null
  plan: string | null
  // Execution
  steps: Step[]
  current_step: number | null
  // Memory
  discoveries: Discovery[]
  decisions: Decision[]
  outcome: string | null
  // Relationships
  parent_id: string | null
  blocked_by: string[]
  created_at: string
  updated_at: string
}

export interface CreateTaskInput {
  title: string
  type: TaskType
  status?: TaskStatus
  intent?: string | null
  description?: string | null
  plan?: string | null
  parent_id?: string | null
  blocked_by?: string[] | null
}

export interface UpdateTaskInput {
  title?: string
  type?: TaskType
  status?: TaskStatus
  intent?: string | null
  description?: string | null
  plan?: string | null
  parent_id?: string | null
  blocked_by?: string[] | null
}

export interface ListTaskFilters {
  status?: TaskStatus
  parent_id?: string | null
}

const TASK_TYPES: TaskType[] = [
  'epic',
  'feature',
  'bug',
  'investigation',
  'chore',
]

const TEMPLATE_TYPE_MAP: Record<TemplateName, TaskType> = {
  epic: 'epic',
  feature: 'feature',
  bug: 'bug',
  investigation: 'investigation',
  chore: 'chore',
}

export type TemplateName =
  | 'epic'
  | 'feature'
  | 'bug'
  | 'investigation'
  | 'chore'

export interface TemplateRecommendation {
  name: TemplateName
  type: TaskType
  plan_template: string
}

export const TEMPLATE_RECOMMENDATIONS: Record<
  TemplateName,
  TemplateRecommendation
> = {
  epic: {
    name: 'epic',
    type: 'epic',
    plan_template: `Plan:\n- Goals:\n  - <outcomes to deliver>\n- Milestones:\n  - <major phases/modules>\n- Dependencies:\n  - <blocking work>\n`,
  },
  feature: {
    name: 'feature',
    type: 'feature',
    plan_template: `Plan:\n- Changes:\n  - <steps>\n- Files:\n  - <files or areas>\n- Tests:\n  - <tests to run/add>\n- Risks:\n  - <edge cases>\n`,
  },
  bug: {
    name: 'bug',
    type: 'bug',
    plan_template: `Plan:\n- Repro:\n  - <steps>\n- Fix:\n  - <approach>\n- Tests:\n  - <coverage>\n- Verify:\n  - <validation steps>\n`,
  },
  investigation: {
    name: 'investigation',
    type: 'investigation',
    plan_template: `Plan:\n- Questions:\n  - <what to answer>\n- Sources:\n  - <files/docs/experiments>\n- Output:\n  - <decision + recommendation>\n`,
  },
  chore: {
    name: 'chore',
    type: 'chore',
    plan_template: `Plan:\n- Changes:\n  - <steps>\n- Files:\n  - <files or areas>\n- Tests:\n  - <tests to run>\n- Safety:\n  - <backups/rollback>\n`,
  },
}

interface TaskRow {
  id: string
  title: string
  type: TaskType
  status: TaskStatus | 'deleted'
  intent: string | null
  description: string | null
  plan: string | null
  steps: string
  current_step: number | null
  discoveries: string
  decisions: string
  outcome: string | null
  parent_id: string | null
  blocked_by: string
  created_at: string
  updated_at: string
}

const dbFilePath = (directory: string) => `${directory}/.continuum/continuum.db`

const dbCache = new Map<string, Database>()

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
  return parse_json_array<Step>(value)
}

function parse_discoveries(value: string | null): Discovery[] {
  return parse_json_array<Discovery>(value)
}

function parse_decisions(value: string | null): Decision[] {
  return parse_json_array<Decision>(value)
}

function row_to_task(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    status: row.status,
    intent: row.intent,
    description: row.description,
    plan: row.plan,
    steps: parse_steps(row.steps),
    current_step: row.current_step,
    discoveries: parse_discoveries(row.discoveries),
    decisions: parse_decisions(row.decisions),
    outcome: row.outcome,
    parent_id: row.parent_id,
    blocked_by: parse_blocked_by(row.blocked_by),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

const TASK_COLUMNS = `id, title, type, status, intent, description, plan, steps, current_step, discoveries, decisions, outcome, parent_id, blocked_by, created_at, updated_at`

export async function get_db(directory: string): Promise<Database> {
  const status = await init_status({ directory })

  if (!status.pluginDirExists) {
    throw new ContinuumError(
      'NOT_INITIALIZED',
      'Continuum is not initialized in this directory',
      ['Run `continuum_init()` to initialize continuum in this directory'],
    )
  }
  if (!status.dbFileExists) {
    throw new ContinuumError(
      'NOT_INITIALIZED',
      'Continuum database file does not exist',
      ['Run `continuum_init()` to initialize continuum in this directory'],
    )
  }

  if (dbCache.has(directory)) {
    return dbCache.get(directory)!
  }

  const db = new Database(dbFilePath(directory))

  // Auto-migrate on first access
  const migrations = await getMigrations()
  const currentVersion = get_db_version(db)
  const latestVersion = migrations[migrations.length - 1]?.version ?? 0

  if (currentVersion < latestVersion) {
    for (const migration of migrations) {
      if (migration.version > currentVersion) {
        db.run(migration.sql.trim())
        set_db_version(db, migration.version)
      }
    }
  }

  dbCache.set(directory, db)
  return db
}

function get_db_version(db: Database): number {
  try {
    const result = db
      .query<{ user_version: number }, []>('PRAGMA user_version')
      .get()
    return result?.user_version ?? 0
  } catch {
    return 0
  }
}

function set_db_version(db: Database, version: number): void {
  db.run(`PRAGMA user_version = ${version}`)
}

export async function init_db(directory: string): Promise<void> {
  const db = new Database(dbFilePath(directory))
  const migrations = await getMigrations()

  // Run initial migration for new databases
  const initialMigration = migrations[0]
  if (initialMigration) {
    db.run(initialMigration.sql.trim())
    set_db_version(db, initialMigration.version)
  }

  db.close()
}

export function is_valid_task_type(type: string): type is TaskType {
  return TASK_TYPES.includes(type as TaskType)
}

export function resolve_template_type(template?: string): TaskType | null {
  if (!template) return null
  return TEMPLATE_TYPE_MAP[template as TemplateName] ?? null
}

export function list_template_recommendations(): TemplateRecommendation[] {
  return Object.values(TEMPLATE_RECOMMENDATIONS)
}

export function validate_task_input(input: CreateTaskInput): string[] {
  const missing: string[] = []
  if (!input.title?.trim()) missing.push('title')

  switch (input.type) {
    case 'epic':
      if (!input.intent?.trim()) missing.push('intent')
      if (!input.description?.trim()) missing.push('description')
      break
    case 'feature':
    case 'bug':
      if (!input.intent?.trim()) missing.push('intent')
      if (!input.description?.trim()) missing.push('description')
      if (!input.plan?.trim()) missing.push('plan')
      break
    case 'investigation':
    case 'chore':
      if (!input.description?.trim()) missing.push('description')
      if (!input.plan?.trim()) missing.push('plan')
      break
  }

  return missing
}

export function validate_status_transition(
  task: Task,
  nextStatus: TaskStatus,
): string[] {
  const missing: string[] = []
  if (nextStatus === 'in_progress') {
    if (['feature', 'bug', 'investigation', 'chore'].includes(task.type)) {
      if (!task.plan?.trim()) missing.push('plan')
    }
  }

  if (nextStatus === 'completed') {
    if (!task.description?.trim()) missing.push('description')
    if (['feature', 'bug', 'investigation', 'chore'].includes(task.type)) {
      if (!task.plan?.trim()) missing.push('plan')
    }
  }

  return missing
}

export async function has_open_blockers(
  db: Database,
  task: Task,
): Promise<string[]> {
  if (task.blocked_by.length === 0) return []
  const placeholders = task.blocked_by.map(() => '?').join(', ')
  const rows = db
    .query<
      { id: string; status: string },
      string[]
    >(`SELECT id, status FROM tasks WHERE id IN (${placeholders}) AND status != 'deleted'`)
    .all(...task.blocked_by)

  const open = new Set(['open', 'in_progress'])
  return rows.filter((row) => open.has(row.status)).map((row) => row.id)
}

async function task_exists(db: Database, task_id: string): Promise<boolean> {
  const row = db
    .query<
      { count: number },
      [string]
    >(`SELECT COUNT(1) AS count FROM tasks WHERE id = ? AND status != 'deleted'`)
    .get(task_id)
  return (row?.count ?? 0) > 0
}

function validate_blocker_list(task_id: string, blockers: string[]) {
  if (blockers.length === 0) return
  const seen = new Set<string>()
  for (const blocker of blockers) {
    if (blocker === task_id) {
      throw new ContinuumError('INVALID_BLOCKER', 'Task cannot block itself', [
        'Remove the task id from blocked_by.',
      ])
    }
    if (seen.has(blocker)) {
      throw new ContinuumError(
        'DUPLICATE_BLOCKERS',
        'blocked_by contains duplicate task ids',
        ['Remove duplicate ids from blocked_by.'],
      )
    }
    seen.add(blocker)
  }
}

async function validate_blockers(
  db: Database,
  blockers: string[],
): Promise<string[]> {
  if (blockers.length === 0) return []
  const unique = Array.from(new Set(blockers))
  const placeholders = unique.map(() => '?').join(', ')
  const rows = db
    .query<
      { id: string },
      string[]
    >(`SELECT id FROM tasks WHERE id IN (${placeholders}) AND status != 'deleted'`)
    .all(...unique)

  const found = new Set(rows.map((row) => row.id))
  return unique.filter((id) => !found.has(id))
}

export async function create_task(
  db: Database,
  input: CreateTaskInput,
): Promise<Task> {
  const id = randomId('tkt')
  const created_at = new Date().toISOString()
  const updated_at = created_at
  const blocked_by = input.blocked_by ?? []

  validate_blocker_list(id, blocked_by)

  if (input.parent_id) {
    const parentExists = await task_exists(db, input.parent_id)
    if (!parentExists) {
      throw new ContinuumError('PARENT_NOT_FOUND', 'Parent task not found', [
        'Verify parent_id and try again.',
      ])
    }
  }

  const missingBlockers = await validate_blockers(db, blocked_by)
  if (missingBlockers.length > 0) {
    throw new ContinuumError(
      'BLOCKER_NOT_FOUND',
      `Blocking tasks not found: ${missingBlockers.join(', ')}`,
      [`Missing blocked_by IDs: ${missingBlockers.join(', ')}`],
    )
  }

  const result = db.run(
    `INSERT INTO tasks (id, title, type, status, intent, description, plan, parent_id, blocked_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.title,
      input.type,
      input.status ?? 'open',
      input.intent ?? null,
      input.description ?? null,
      input.plan ?? null,
      input.parent_id ?? null,
      JSON.stringify(blocked_by),
      created_at,
      updated_at,
    ],
  )

  if (result.changes === 0) {
    throw new ContinuumError('TASK_CREATE_FAILED', 'Failed to create task')
  }

  const row = db
    .query<TaskRow, [string]>(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`)
    .get(id)

  if (!row) {
    throw new ContinuumError('TASK_NOT_FOUND', 'Task not found after create')
  }

  return row_to_task(row)
}

export async function update_task(
  db: Database,
  task_id: string,
  input: UpdateTaskInput,
): Promise<Task> {
  const updates: string[] = []
  const params: Array<string | null> = []

  if (input.parent_id !== undefined) {
    if (input.parent_id) {
      const parentExists = await task_exists(db, input.parent_id)
      if (!parentExists) {
        throw new ContinuumError('PARENT_NOT_FOUND', 'Parent task not found', [
          'Verify parent_id and try again.',
        ])
      }
    }
  }

  if (input.blocked_by !== undefined) {
    validate_blocker_list(task_id, input.blocked_by ?? [])
    const missingBlockers = await validate_blockers(db, input.blocked_by ?? [])
    if (missingBlockers.length > 0) {
      throw new ContinuumError(
        'BLOCKER_NOT_FOUND',
        `Blocking tasks not found: ${missingBlockers.join(', ')}`,
        [`Missing blocked_by IDs: ${missingBlockers.join(', ')}`],
      )
    }
  }

  // null values allowed here to remove fields

  if (input.title !== undefined) {
    updates.push('title = ?')
    params.push(input.title)
  }
  if (input.type !== undefined) {
    updates.push('type = ?')
    params.push(input.type)
  }
  if (input.status !== undefined) {
    updates.push('status = ?')
    params.push(input.status)
  }
  if (input.intent !== undefined) {
    updates.push('intent = ?')
    params.push(input.intent)
  }
  if (input.description !== undefined) {
    updates.push('description = ?')
    params.push(input.description)
  }
  if (input.plan !== undefined) {
    updates.push('plan = ?')
    params.push(input.plan)
  }
  if (input.parent_id !== undefined) {
    updates.push('parent_id = ?')
    params.push(input.parent_id)
  }
  if (input.blocked_by !== undefined) {
    updates.push('blocked_by = ?')
    params.push(JSON.stringify(input.blocked_by ?? []))
  }

  if (updates.length === 0) {
    throw new ContinuumError('NO_CHANGES_MADE', 'No fields to update')
  }

  updates.push('updated_at = ?')
  params.push(new Date().toISOString())
  params.push(task_id)

  const result = db.run(
    `UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`,
    params,
  )

  if (result.changes === 0) {
    throw new ContinuumError('TASK_UPDATE_FAILED', 'Failed to update task')
  }

  const row = db
    .query<TaskRow, [string]>(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`)
    .get(task_id)

  if (!row) {
    throw new ContinuumError('TASK_NOT_FOUND', 'Task not found after update')
  }

  return row_to_task(row)
}

export async function get_task(
  db: Database,
  task_id: string,
): Promise<Task | null> {
  const row = db
    .query<TaskRow, [string]>(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`)
    .get(task_id)

  return row ? row_to_task(row) : null
}

export async function list_tasks(
  db: Database,
  filters: ListTaskFilters = {},
): Promise<Task[]> {
  const where: string[] = ['status != ?']
  const params: Array<string | null> = ['deleted']

  if (filters.status) {
    where.push('status = ?')
    params.push(filters.status)
  }

  if (filters.parent_id !== undefined) {
    if (filters.parent_id === null) {
      where.push('parent_id IS NULL')
    } else {
      where.push('parent_id = ?')
      params.push(filters.parent_id)
    }
  }

  const sql = `
    SELECT ${TASK_COLUMNS}
    FROM tasks
    WHERE ${where.join(' AND ')}
    ORDER BY created_at ASC
  `

  const rows = db.query<TaskRow, Array<string | null>>(sql).all(...params)
  return rows.map(row_to_task)
}

export async function list_tasks_by_statuses(
  db: Database,
  filters: { statuses: TaskStatus[]; parent_id?: string | null },
): Promise<Task[]> {
  const where: string[] = ['status != ?']
  const params: Array<string | null> = ['deleted']

  if (filters.statuses.length > 0) {
    const placeholders = filters.statuses.map(() => '?').join(', ')
    where.push(`status IN (${placeholders})`)
    params.push(...filters.statuses)
  }

  if (filters.parent_id !== undefined) {
    if (filters.parent_id === null) {
      where.push('parent_id IS NULL')
    } else {
      where.push('parent_id = ?')
      params.push(filters.parent_id)
    }
  }

  const sql = `
    SELECT ${TASK_COLUMNS}
    FROM tasks
    WHERE ${where.join(' AND ')}
    ORDER BY created_at ASC
  `

  const rows = db.query<TaskRow, Array<string | null>>(sql).all(...params)
  return rows.map(row_to_task)
}

// =============================================================================
// Execution Model Functions
// =============================================================================

export interface AddStepsInput {
  task_id: string
  steps: Array<{
    title?: string
    summary?: string
    details?: string
  }>
}

export async function add_steps(
  db: Database,
  input: AddStepsInput,
): Promise<Task> {
  const task = await get_task(db, input.task_id)
  if (!task) {
    throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
  }

  const existingSteps = task.steps
  const maxId = existingSteps.reduce((max, s) => Math.max(max, s.id), 0)

  const newSteps: Step[] = input.steps.map((s, i) => ({
    id: maxId + i + 1,
    title: s.title,
    summary: s.summary,
    details: s.details,
    status: 'pending' as StepStatus,
    notes: null,
  }))

  const allSteps = [...existingSteps, ...newSteps]

  // If no current_step set and we have steps, set to first pending
  let currentStep = task.current_step
  if (currentStep === null && allSteps.length > 0) {
    const firstPending = allSteps.find((s) => s.status === 'pending')
    currentStep = firstPending?.id ?? null
  }

  const result = db.run(
    `UPDATE tasks SET steps = ?, current_step = ?, updated_at = ? WHERE id = ?`,
    [
      JSON.stringify(allSteps),
      currentStep,
      new Date().toISOString(),
      input.task_id,
    ],
  )

  if (result.changes === 0) {
    throw new ContinuumError('TASK_UPDATE_FAILED', 'Failed to add steps')
  }

  return (await get_task(db, input.task_id))!
}

export interface CompleteStepInput {
  task_id: string
  step_id?: number // If not provided, completes current_step
  notes?: string
}

export async function complete_step(
  db: Database,
  input: CompleteStepInput,
): Promise<Task> {
  const task = await get_task(db, input.task_id)
  if (!task) {
    throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
  }

  const stepId = input.step_id ?? task.current_step
  if (stepId === null) {
    throw new ContinuumError(
      'ITEM_NOT_FOUND',
      'No step to complete (no current_step set)',
      ['Add steps first using step_add, or specify step_id explicitly'],
    )
  }

  const stepIndex = task.steps.findIndex((s) => s.id === stepId)
  if (stepIndex === -1) {
    throw new ContinuumError('ITEM_NOT_FOUND', `Step ${stepId} not found`)
  }

  const existingStep = task.steps[stepIndex]!
  const updatedSteps = [...task.steps]
  updatedSteps[stepIndex] = {
    id: existingStep.id,
    title: existingStep.title,
    summary: existingStep.summary,
    details: existingStep.details,
    status: 'completed',
    notes: input.notes ?? existingStep.notes,
  }

  // Auto-advance to next pending step
  let nextStep: number | null = null
  for (const step of updatedSteps) {
    if (step.status === 'pending') {
      nextStep = step.id
      break
    }
  }

  const result = db.run(
    `UPDATE tasks SET steps = ?, current_step = ?, updated_at = ? WHERE id = ?`,
    [
      JSON.stringify(updatedSteps),
      nextStep,
      new Date().toISOString(),
      input.task_id,
    ],
  )

  if (result.changes === 0) {
    throw new ContinuumError('TASK_UPDATE_FAILED', 'Failed to complete step')
  }

  return (await get_task(db, input.task_id))!
}

export interface UpdateStepInput {
  task_id: string
  step_id: number
  title?: string
  summary?: string
  details?: string
  status?: StepStatus
  notes?: string
}

export async function update_step(
  db: Database,
  input: UpdateStepInput,
): Promise<Task> {
  const task = await get_task(db, input.task_id)
  if (!task) {
    throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
  }

  const stepIndex = task.steps.findIndex((s) => s.id === input.step_id)
  if (stepIndex === -1) {
    throw new ContinuumError(
      'ITEM_NOT_FOUND',
      `Step ${input.step_id} not found`,
    )
  }

  const existingStep = task.steps[stepIndex]!
  const updatedSteps = [...task.steps]
  updatedSteps[stepIndex] = {
    id: existingStep.id,
    title: input.title ?? existingStep.title,
    summary: input.summary ?? existingStep.summary,
    details: input.details ?? existingStep.details,
    status: input.status ?? existingStep.status,
    notes: input.notes !== undefined ? input.notes : existingStep.notes,
  }

  const result = db.run(
    `UPDATE tasks SET steps = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(updatedSteps), new Date().toISOString(), input.task_id],
  )

  if (result.changes === 0) {
    throw new ContinuumError('TASK_UPDATE_FAILED', 'Failed to update step')
  }

  return (await get_task(db, input.task_id))!
}

export interface AddDiscoveryInput {
  task_id: string
  content: string
}

export async function add_discovery(
  db: Database,
  input: AddDiscoveryInput,
): Promise<Task> {
  const task = await get_task(db, input.task_id)
  if (!task) {
    throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
  }

  const maxId = task.discoveries.reduce((max, d) => Math.max(max, d.id), 0)
  const discovery: Discovery = {
    id: maxId + 1,
    content: input.content,
    created_at: new Date().toISOString(),
  }

  const discoveries = [...task.discoveries, discovery]

  const result = db.run(
    `UPDATE tasks SET discoveries = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(discoveries), new Date().toISOString(), input.task_id],
  )

  if (result.changes === 0) {
    throw new ContinuumError('TASK_UPDATE_FAILED', 'Failed to add discovery')
  }

  return (await get_task(db, input.task_id))!
}

export interface AddDecisionInput {
  task_id: string
  content: string
  rationale?: string
}

export async function add_decision(
  db: Database,
  input: AddDecisionInput,
): Promise<Task> {
  const task = await get_task(db, input.task_id)
  if (!task) {
    throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
  }

  const maxId = task.decisions.reduce((max, d) => Math.max(max, d.id), 0)
  const decision: Decision = {
    id: maxId + 1,
    content: input.content,
    rationale: input.rationale ?? null,
    created_at: new Date().toISOString(),
  }

  const decisions = [...task.decisions, decision]

  const result = db.run(
    `UPDATE tasks SET decisions = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(decisions), new Date().toISOString(), input.task_id],
  )

  if (result.changes === 0) {
    throw new ContinuumError('TASK_UPDATE_FAILED', 'Failed to add decision')
  }

  return (await get_task(db, input.task_id))!
}

export interface CompleteTaskInput {
  task_id: string
  outcome: string
}

export async function complete_task(
  db: Database,
  input: CompleteTaskInput,
): Promise<Task> {
  const task = await get_task(db, input.task_id)
  if (!task) {
    throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
  }

  // Check for open blockers
  const openBlockers = await has_open_blockers(db, task)
  if (openBlockers.length > 0) {
    throw new ContinuumError(
      'HAS_BLOCKERS',
      `Task has unresolved blockers: ${openBlockers.join(', ')}`,
      [`Complete blockers first: ${openBlockers.join(', ')}`],
    )
  }

  const result = db.run(
    `UPDATE tasks SET status = 'completed', outcome = ?, updated_at = ? WHERE id = ?`,
    [input.outcome, new Date().toISOString(), input.task_id],
  )

  if (result.changes === 0) {
    throw new ContinuumError('TASK_UPDATE_FAILED', 'Failed to complete task')
  }

  return (await get_task(db, input.task_id))!
}
