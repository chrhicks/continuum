import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  addMcpTaskNote,
  addMcpTaskSteps,
  completeMcpTask,
  completeMcpTaskStep,
  createMcpTask,
  deleteMcpTask,
  getMcpTask,
  graphMcpTasks,
  listMcpTasks,
  listMcpTaskSteps,
  updateMcpTask,
  updateMcpTaskStep,
  validateMcpTask,
} from './task-tools'
import { initMcpWorkspace } from './init-tool'
import {
  idSchema,
  listTaskStatusSchema,
  positiveIntegerSchema,
  taskCreateSchema,
  taskPatchSchema,
  taskStatusSchema,
  taskStepPatchSchema,
  taskStepSchema,
  taskTypeSchema,
  workspaceSchema,
} from './task-schemas'
import { toolResult } from './result'

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}
const write = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
}

export function registerTaskTools(server: McpServer): void {
  registerTaskReadTools(server)
  registerTaskWriteTools(server)
  registerTaskStepTools(server)
  registerTaskNoteTool(server)
  registerInitTool(server)
}

function registerTaskReadTools(server: McpServer): void {
  server.registerTool(
    'continuum_task_list',
    {
      description: 'List project tasks with filtering and cursor pagination.',
      inputSchema: {
        workspace: workspaceSchema(),
        options: z
          .object({
            status: listTaskStatusSchema().optional(),
            type: taskTypeSchema().optional(),
            parentId: z.string().nullable().optional(),
            includeDeleted: z.boolean().optional(),
            cursor: z.string().optional(),
            limit: positiveIntegerSchema().max(1000).optional(),
            sort: z.enum(['createdAt', 'updatedAt', 'priority']).optional(),
            order: z.enum(['asc', 'desc']).optional(),
          })
          .optional(),
      },
      annotations: readOnly,
    },
    async (input) => toolResult(await listMcpTasks(input)),
  )
  server.registerTool(
    'continuum_task_get',
    {
      description: 'Get one task with optional relationship expansion.',
      inputSchema: {
        workspace: workspaceSchema(),
        id: idSchema(),
        expand: z.array(z.enum(['parent', 'children', 'blockers'])).optional(),
        includeDeleted: z.boolean().optional(),
      },
      annotations: readOnly,
    },
    async (input) => toolResult(await getMcpTask(input)),
  )
  server.registerTool(
    'continuum_task_validate',
    {
      description: 'Validate whether a task is ready for a target status.',
      inputSchema: {
        workspace: workspaceSchema(),
        id: idSchema(),
        transition: taskStatusSchema(),
      },
      annotations: readOnly,
    },
    async (input) => toolResult(await validateMcpTask(input)),
  )
  server.registerTool(
    'continuum_task_graph',
    {
      description: 'Query task ancestors, descendants, or direct children.',
      inputSchema: {
        workspace: workspaceSchema(),
        id: idSchema(),
        query: z.enum(['ancestors', 'descendants', 'children']),
      },
      annotations: readOnly,
    },
    async (input) => toolResult(await graphMcpTasks(input)),
  )
}

function registerTaskWriteTools(server: McpServer): void {
  server.registerTool(
    'continuum_task_create',
    {
      description: 'Create a task in an initialized workspace.',
      inputSchema: { workspace: workspaceSchema(), task: taskCreateSchema() },
      annotations: write,
    },
    async (input) => toolResult(await createMcpTask(input)),
  )
  server.registerTool(
    'continuum_task_update',
    {
      description: 'Update task fields.',
      inputSchema: {
        workspace: workspaceSchema(),
        id: idSchema(),
        patch: taskPatchSchema(),
      },
      annotations: write,
    },
    async (input) => toolResult(await updateMcpTask(input)),
  )
  server.registerTool(
    'continuum_task_complete',
    {
      description: 'Complete a task with an outcome summary.',
      inputSchema: {
        workspace: workspaceSchema(),
        id: idSchema(),
        outcome: z.string().min(1),
      },
      annotations: write,
    },
    async (input) => toolResult(await completeMcpTask(input)),
  )
  server.registerTool(
    'continuum_task_delete',
    {
      description: 'Soft-delete a task.',
      inputSchema: { workspace: workspaceSchema(), id: idSchema() },
      annotations: { ...write, destructiveHint: true, idempotentHint: true },
    },
    async (input) => toolResult(await deleteMcpTask(input)),
  )
}

function registerTaskStepTools(server: McpServer): void {
  server.registerTool(
    'continuum_task_steps_list',
    {
      description: 'List the steps on a task.',
      inputSchema: { workspace: workspaceSchema(), id: idSchema() },
      annotations: readOnly,
    },
    async (input) => toolResult(await listMcpTaskSteps(input)),
  )
  server.registerTool(
    'continuum_task_steps_add',
    {
      description: 'Add one or more ordered steps to a task.',
      inputSchema: {
        workspace: workspaceSchema(),
        id: idSchema(),
        steps: z.array(taskStepSchema()).min(1),
      },
      annotations: write,
    },
    async (input) => toolResult(await addMcpTaskSteps(input)),
  )
  server.registerTool(
    'continuum_task_steps_update',
    {
      description: 'Update one task step.',
      inputSchema: {
        workspace: workspaceSchema(),
        id: idSchema(),
        stepId: idSchema(),
        patch: taskStepPatchSchema(),
      },
      annotations: write,
    },
    async (input) => toolResult(await updateMcpTaskStep(input)),
  )
  server.registerTool(
    'continuum_task_steps_complete',
    {
      description: 'Complete a task step, defaulting to the current step.',
      inputSchema: {
        workspace: workspaceSchema(),
        id: idSchema(),
        stepId: idSchema().optional(),
        notes: z.string().optional(),
      },
      annotations: write,
    },
    async (input) => toolResult(await completeMcpTaskStep(input)),
  )
}

function registerTaskNoteTool(server: McpServer): void {
  server.registerTool(
    'continuum_task_note_add',
    {
      description: 'Add a discovery or decision note to a task.',
      inputSchema: {
        workspace: workspaceSchema(),
        id: idSchema(),
        kind: z.enum(['discovery', 'decision']),
        content: z.string().min(1),
        source: z.enum(['user', 'agent', 'system']).optional(),
        rationale: z.string().optional(),
        impact: z.string().optional(),
      },
      annotations: write,
    },
    async (input) => toolResult(await addMcpTaskNote(input)),
  )
}

function registerInitTool(server: McpServer): void {
  server.registerTool(
    'continuum_init',
    {
      description: 'Initialize and migrate Continuum in an existing directory.',
      inputSchema: { workspace: workspaceSchema() },
      annotations: { ...write, idempotentHint: true },
    },
    async (input) => toolResult(await initMcpWorkspace(input)),
  )
}
