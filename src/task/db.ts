import { Database } from 'bun:sqlite'
import { randomId } from './db.utils'
import { init_status } from './util'
import { ContinuumError } from './error'
import { getMigrations } from './migration'

export type TaskStatus =
  | 'open'
  | 'ready'
  | 'blocked'
  | 'completed'
  | 'cancelled'
export type TaskType = 'epic' | 'feature' | 'bug' | 'investigation' | 'chore'
export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped'

export interface Step {
  id: number
  title?: string
  description?: string
  position?: number | null
  summary?: string
  details?: string
  status: StepStatus
  notes: string | null
}

export interface Discovery {
  id: number
  content: string
  source: 'user' | 'agent' | 'system'
  impact: string | null
  created_at: string
}

export interface Decision {
  id: number
  content: string
  rationale: string | null
  source: 'user' | 'agent' | 'system'
  impact: string | null
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
  completed_at: string | null
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
  steps?: CollectionPatch<StepInput, StepPatch>
  discoveries?: CollectionPatch<DiscoveryInput, DiscoveryPatch>
  decisions?: CollectionPatch<DecisionInput, DecisionPatch>
}

export interface StepInput {
  title: string
  description: string
  status?: StepStatus
  position?: number | null
  summary?: string
  details?: string
  notes?: string | null
}

export interface StepPatch {
  id: number | string
  title?: string
  description?: string
  status?: StepStatus
  position?: number | null
  summary?: string
  details?: string
  notes?: string | null
}

export interface DiscoveryInput {
  content: string
  source?: 'user' | 'agent' | 'system'
  impact?: string | null
}

export interface DiscoveryPatch {
  id: number | string
  content?: string
  source?: 'user' | 'agent' | 'system'
  impact?: string | null
}

export interface DecisionInput {
  content: string
  rationale?: string | null
  source?: 'user' | 'agent' | 'system'
  impact?: string | null
}

export interface DecisionPatch {
  id: number | string
  content?: string
  rationale?: string | null
  source?: 'user' | 'agent' | 'system'
  impact?: string | null
}

export interface CollectionPatch<TAdd, TUpdate> {
  add?: TAdd[]
  update?: TUpdate[]
  delete?: Array<number | string>
}

export interface ListTaskFilters {
  status?: TaskStatus
  type?: TaskType
  parent_id?: string | null
  cursor?: string
  limit?: number
  sort?: 'createdAt' | 'updatedAt'
  order?: 'asc' | 'desc'
}

export interface ListTasksResult {
  tasks: Task[]
  nextCursor?: string
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
  completed_at: string | null
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

function encode_cursor(sortValue: string, id: string): string {
  return Buffer.from(JSON.stringify({ sortValue, id }), 'utf-8').toString(
    'base64',
  )
}

function decode_cursor(
  cursor: string | undefined,
): { sortValue: string; id: string } | null {
  if (!cursor) return null
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf-8')
    const parsed = JSON.parse(raw) as { sortValue?: string; id?: string }
    if (!parsed.sortValue || !parsed.id) return null
    return { sortValue: parsed.sortValue, id: parsed.id }
  } catch {
    return null
  }
}

function normalize_id(id: number | string, label: string): number {
  const value = typeof id === 'string' ? Number(id) : id
  if (!Number.isFinite(value)) {
    throw new ContinuumError('ITEM_NOT_FOUND', `${label} ${id} not found`)
  }
  return value
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
    completed_at: row.completed_at,
    parent_id: row.parent_id,
    blocked_by: parse_blocked_by(row.blocked_by),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

const TASK_COLUMNS = `id, title, type, status, intent, description, plan, steps, current_step, discoveries, decisions, outcome, completed_at, parent_id, blocked_by, created_at, updated_at`

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
  if (nextStatus === 'ready') {
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

  const open = new Set(['open', 'ready', 'blocked'])
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
  const completed_at = input.status === 'completed' ? created_at : null
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
    `INSERT INTO tasks (id, title, type, status, intent, description, plan, parent_id, blocked_by, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      completed_at,
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
  const params: Array<string | number | null> = []
  let task: Task | null = null

  const ensure_task = async (): Promise<Task> => {
    if (!task) {
      task = await get_task(db, task_id)
    }
    if (!task) {
      throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
    }
    return task
  }

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
    if (input.status === 'completed') {
      updates.push('completed_at = ?')
      params.push(new Date().toISOString())
    } else {
      updates.push('completed_at = ?')
      params.push(null)
    }
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

  if (input.steps) {
    const currentTask = await ensure_task()
    const existingSteps = [...currentTask.steps]
    let currentStep = currentTask.current_step

    if (input.steps.delete && input.steps.delete.length > 0) {
      const deleteIds = new Set(
        input.steps.delete.map((id) => normalize_id(id, 'Step')),
      )
      for (const stepId of deleteIds) {
        const exists = existingSteps.some((step) => step.id === stepId)
        if (!exists) {
          throw new ContinuumError('ITEM_NOT_FOUND', `Step ${stepId} not found`)
        }
      }
      const filtered = existingSteps.filter((step) => !deleteIds.has(step.id))
      existingSteps.length = 0
      existingSteps.push(...filtered)
      if (currentStep !== null && deleteIds.has(currentStep)) {
        currentStep = null
      }
    }

    if (input.steps.update && input.steps.update.length > 0) {
      for (const patch of input.steps.update) {
        const stepId = normalize_id(patch.id, 'Step')
        const index = existingSteps.findIndex((step) => step.id === stepId)
        if (index === -1) {
          throw new ContinuumError('ITEM_NOT_FOUND', `Step ${stepId} not found`)
        }
        const existing = existingSteps[index]!
        const description =
          patch.description !== undefined
            ? patch.description
            : patch.details !== undefined
              ? patch.details
              : (existing.description ?? existing.details ?? '')
        const details =
          patch.details !== undefined ? patch.details : existing.details
        existingSteps[index] = {
          id: existing.id,
          title: patch.title ?? existing.title,
          description,
          position:
            patch.position !== undefined ? patch.position : existing.position,
          summary: patch.summary ?? existing.summary,
          details,
          status: patch.status ?? existing.status,
          notes: patch.notes !== undefined ? patch.notes : existing.notes,
        }
      }
    }

    if (input.steps.add && input.steps.add.length > 0) {
      const maxId = existingSteps.reduce((max, s) => Math.max(max, s.id), 0)
      const newSteps: Step[] = input.steps.add.map((step, index) => ({
        id: maxId + index + 1,
        title: step.title,
        description: step.description ?? step.details ?? '',
        position: step.position ?? 0,
        summary: step.summary,
        details: step.details,
        status: step.status ?? 'pending',
        notes: step.notes ?? null,
      }))
      existingSteps.push(...newSteps)
    }

    const normalized = existingSteps.map((step) => ({
      id: step.id,
      title: step.title,
      description: step.description ?? step.details ?? '',
      position: step.position ?? 0,
      summary: step.summary,
      details: step.details,
      status: step.status ?? 'pending',
      notes: step.notes ?? null,
    }))

    if (currentStep === null && normalized.length > 0) {
      const firstPending = normalized.find((step) => step.status === 'pending')
      currentStep = firstPending?.id ?? null
    }

    updates.push('steps = ?')
    params.push(JSON.stringify(normalized))
    updates.push('current_step = ?')
    params.push(currentStep)
  }

  if (input.discoveries) {
    const currentTask = await ensure_task()
    const existing = [...currentTask.discoveries]

    if (input.discoveries.delete && input.discoveries.delete.length > 0) {
      const deleteIds = new Set(
        input.discoveries.delete.map((id) => normalize_id(id, 'Discovery')),
      )
      for (const discoveryId of deleteIds) {
        const exists = existing.some((item) => item.id === discoveryId)
        if (!exists) {
          throw new ContinuumError(
            'ITEM_NOT_FOUND',
            `Discovery ${discoveryId} not found`,
          )
        }
      }
      const filtered = existing.filter((item) => !deleteIds.has(item.id))
      existing.length = 0
      existing.push(...filtered)
    }

    if (input.discoveries.update && input.discoveries.update.length > 0) {
      for (const patch of input.discoveries.update) {
        const discoveryId = normalize_id(patch.id, 'Discovery')
        const index = existing.findIndex((item) => item.id === discoveryId)
        if (index === -1) {
          throw new ContinuumError(
            'ITEM_NOT_FOUND',
            `Discovery ${discoveryId} not found`,
          )
        }
        const current = existing[index]!
        existing[index] = {
          id: current.id,
          content: patch.content ?? current.content,
          source: patch.source ?? current.source ?? 'system',
          impact:
            patch.impact !== undefined
              ? patch.impact
              : (current.impact ?? null),
          created_at: current.created_at,
        }
      }
    }

    if (input.discoveries.add && input.discoveries.add.length > 0) {
      const maxId = existing.reduce((max, item) => Math.max(max, item.id), 0)
      const newItems: Discovery[] = input.discoveries.add.map(
        (item, index) => ({
          id: maxId + index + 1,
          content: item.content,
          source: item.source ?? 'system',
          impact: item.impact ?? null,
          created_at: new Date().toISOString(),
        }),
      )
      existing.push(...newItems)
    }

    updates.push('discoveries = ?')
    params.push(JSON.stringify(existing))
  }

  if (input.decisions) {
    const currentTask = await ensure_task()
    const existing = [...currentTask.decisions]

    if (input.decisions.delete && input.decisions.delete.length > 0) {
      const deleteIds = new Set(
        input.decisions.delete.map((id) => normalize_id(id, 'Decision')),
      )
      for (const decisionId of deleteIds) {
        const exists = existing.some((item) => item.id === decisionId)
        if (!exists) {
          throw new ContinuumError(
            'ITEM_NOT_FOUND',
            `Decision ${decisionId} not found`,
          )
        }
      }
      const filtered = existing.filter((item) => !deleteIds.has(item.id))
      existing.length = 0
      existing.push(...filtered)
    }

    if (input.decisions.update && input.decisions.update.length > 0) {
      for (const patch of input.decisions.update) {
        const decisionId = normalize_id(patch.id, 'Decision')
        const index = existing.findIndex((item) => item.id === decisionId)
        if (index === -1) {
          throw new ContinuumError(
            'ITEM_NOT_FOUND',
            `Decision ${decisionId} not found`,
          )
        }
        const current = existing[index]!
        existing[index] = {
          id: current.id,
          content: patch.content ?? current.content,
          rationale:
            patch.rationale !== undefined ? patch.rationale : current.rationale,
          source: patch.source ?? current.source ?? 'system',
          impact:
            patch.impact !== undefined
              ? patch.impact
              : (current.impact ?? null),
          created_at: current.created_at,
        }
      }
    }

    if (input.decisions.add && input.decisions.add.length > 0) {
      const maxId = existing.reduce((max, item) => Math.max(max, item.id), 0)
      const newItems: Decision[] = input.decisions.add.map((item, index) => ({
        id: maxId + index + 1,
        content: item.content,
        rationale: item.rationale ?? null,
        source: item.source ?? 'system',
        impact: item.impact ?? null,
        created_at: new Date().toISOString(),
      }))
      existing.push(...newItems)
    }

    updates.push('decisions = ?')
    params.push(JSON.stringify(existing))
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
): Promise<ListTasksResult> {
  const where: string[] = ['status != ?']
  const params: Array<string | null> = ['deleted']

  if (filters.status) {
    where.push('status = ?')
    params.push(filters.status)
  }

  if (filters.type) {
    where.push('type = ?')
    params.push(filters.type)
  }

  if (filters.parent_id !== undefined) {
    if (filters.parent_id === null) {
      where.push('parent_id IS NULL')
    } else {
      where.push('parent_id = ?')
      params.push(filters.parent_id)
    }
  }

  const sortColumn = filters.sort === 'updatedAt' ? 'updated_at' : 'created_at'
  const sortOrder = filters.order === 'desc' ? 'DESC' : 'ASC'
  const limit = filters.limit && filters.limit > 0 ? filters.limit : 50
  const cursor = decode_cursor(filters.cursor)

  if (cursor) {
    const comparator = sortOrder === 'DESC' ? '<' : '>'
    where.push(`(${sortColumn}, id) ${comparator} (?, ?)`)
    params.push(cursor.sortValue, cursor.id)
  }

  const sql = `
    SELECT ${TASK_COLUMNS}
    FROM tasks
    WHERE ${where.join(' AND ')}
    ORDER BY ${sortColumn} ${sortOrder}, id ${sortOrder}
    LIMIT ?
  `

  const rows = db
    .query<TaskRow, Array<string | null | number>>(sql)
    .all(...params, limit + 1)

  const hasMore = rows.length > limit
  const slice = hasMore ? rows.slice(0, limit) : rows
  const tasks = slice.map(row_to_task)

  if (!hasMore) {
    return { tasks }
  }

  const last = slice[slice.length - 1]!
  const sortValue =
    sortColumn === 'updated_at' ? last.updated_at : last.created_at

  return {
    tasks,
    nextCursor: encode_cursor(sortValue, last.id),
  }
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

export async function delete_task(
  db: Database,
  task_id: string,
): Promise<void> {
  const now = new Date().toISOString()
  const result = db.run(
    `UPDATE tasks SET status = 'deleted', updated_at = ? WHERE id = ?`,
    [now, task_id],
  )

  if (result.changes === 0) {
    throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
  }
}

// =============================================================================
// Execution Model Functions
// =============================================================================

export interface AddStepsInput {
  task_id: string
  steps: Array<{
    title?: string
    description?: string
    position?: number | null
    status?: StepStatus
    summary?: string
    details?: string
    notes?: string | null
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
    description: s.description ?? s.details ?? '',
    position: s.position ?? 0,
    summary: s.summary,
    details: s.details,
    status: s.status ?? 'pending',
    notes: s.notes ?? null,
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
    description: existingStep.description ?? existingStep.details ?? '',
    position: existingStep.position ?? 0,
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
  description?: string
  position?: number | null
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
  const description =
    input.description !== undefined
      ? input.description
      : input.details !== undefined
        ? input.details
        : (existingStep.description ?? existingStep.details ?? '')
  const details =
    input.details !== undefined ? input.details : existingStep.details
  updatedSteps[stepIndex] = {
    id: existingStep.id,
    title: input.title ?? existingStep.title,
    description,
    position:
      input.position !== undefined ? input.position : existingStep.position,
    summary: input.summary ?? existingStep.summary,
    details,
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
  source?: 'user' | 'agent' | 'system'
  impact?: string | null
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
    source: input.source ?? 'system',
    impact: input.impact ?? null,
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
  source?: 'user' | 'agent' | 'system'
  impact?: string | null
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
    source: input.source ?? 'system',
    impact: input.impact ?? null,
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

  const now = new Date().toISOString()
  const result = db.run(
    `UPDATE tasks SET status = 'completed', outcome = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
    [input.outcome, now, now, input.task_id],
  )

  if (result.changes === 0) {
    throw new ContinuumError('TASK_UPDATE_FAILED', 'Failed to complete task')
  }

  return (await get_task(db, input.task_id))!
}
