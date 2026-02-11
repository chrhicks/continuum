import { getDbClient } from '../db/client'
import { ContinuumError } from './error'
import { init_status } from './util'
import type {
  AddDecisionInput,
  AddDiscoveryInput,
  AddStepsInput,
  CompleteStepInput,
  CompleteTaskInput,
  CreateTaskInput,
  ListTaskFilters,
  ListTasksResult,
  Task,
  TaskStatus,
  UpdateStepInput,
  UpdateTaskInput,
} from './types'
import {
  add_decision,
  add_discovery,
  add_steps,
  complete_step,
  complete_task,
  create_task,
  delete_task,
  get_task,
  list_tasks,
  list_tasks_by_statuses,
  has_open_blockers,
  update_step,
  update_task,
} from './tasks.repository'

async function get_task_db(directory: string) {
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

  const { db } = await getDbClient(directory)
  return db
}

export async function list_tasks_for_directory(
  directory: string,
  filters: ListTaskFilters = {},
): Promise<ListTasksResult> {
  const db = await get_task_db(directory)
  return list_tasks(db, filters)
}

export async function list_tasks_by_statuses_for_directory(
  directory: string,
  filters: { statuses: TaskStatus[]; parent_id?: string | null },
): Promise<Task[]> {
  const db = await get_task_db(directory)
  return list_tasks_by_statuses(db, filters)
}

export async function get_task_for_directory(
  directory: string,
  task_id: string,
): Promise<Task | null> {
  const db = await get_task_db(directory)
  return get_task(db, task_id)
}

export async function create_task_for_directory(
  directory: string,
  input: CreateTaskInput,
): Promise<Task> {
  const db = await get_task_db(directory)
  return create_task(db, input)
}

export async function update_task_for_directory(
  directory: string,
  task_id: string,
  input: UpdateTaskInput,
): Promise<Task> {
  const db = await get_task_db(directory)
  return update_task(db, task_id, input)
}

export async function delete_task_for_directory(
  directory: string,
  task_id: string,
): Promise<void> {
  const db = await get_task_db(directory)
  await delete_task(db, task_id)
}

export async function complete_task_for_directory(
  directory: string,
  input: CompleteTaskInput,
): Promise<Task> {
  const db = await get_task_db(directory)
  return complete_task(db, input)
}

export async function add_steps_for_directory(
  directory: string,
  input: AddStepsInput,
): Promise<Task> {
  const db = await get_task_db(directory)
  return add_steps(db, input)
}

export async function complete_step_for_directory(
  directory: string,
  input: CompleteStepInput,
): Promise<Task> {
  const db = await get_task_db(directory)
  return complete_step(db, input)
}

export async function update_step_for_directory(
  directory: string,
  input: UpdateStepInput,
): Promise<Task> {
  const db = await get_task_db(directory)
  return update_step(db, input)
}

export async function add_discovery_for_directory(
  directory: string,
  input: AddDiscoveryInput,
): Promise<Task> {
  const db = await get_task_db(directory)
  return add_discovery(db, input)
}

export async function add_decision_for_directory(
  directory: string,
  input: AddDecisionInput,
): Promise<Task> {
  const db = await get_task_db(directory)
  return add_decision(db, input)
}

export async function get_open_blockers_for_directory(
  directory: string,
  task_id: string,
): Promise<string[]> {
  const db = await get_task_db(directory)
  const task = await get_task(db, task_id)
  if (!task) {
    throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
  }
  return has_open_blockers(db, task)
}
