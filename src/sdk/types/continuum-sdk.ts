import type {
  CompleteTaskInput,
  CreateTaskInput,
  ListTasksOptions,
  ListTasksResult,
  TaskGraphQuery,
  TaskGraphResult,
  TaskNoteInput,
  TaskStepCompleteResult,
  TaskStepInput,
  TaskValidationResult,
  UpdateTaskInput,
} from './task-operations'
import type {
  InitStatus,
  Task,
  TaskDecision,
  TaskDiscovery,
  TaskStatus,
  TaskStep,
} from './task-models'

export interface ContinuumSDK {
  task: {
    init: () => Promise<InitStatus>
    list: (options?: ListTasksOptions) => Promise<ListTasksResult>
    get: (id: string) => Promise<Task | null>
    create: (input: CreateTaskInput) => Promise<Task>
    update: (id: string, input?: UpdateTaskInput) => Promise<Task>
    complete: (id: string, input: CompleteTaskInput) => Promise<Task>
    delete: (id: string) => Promise<void>
    validateTransition: (
      id: string,
      nextStatus: TaskStatus,
    ) => Promise<TaskValidationResult>
    graph: (query: TaskGraphQuery, taskId: string) => Promise<TaskGraphResult>
    steps: {
      add: (taskId: string, input: { steps: TaskStepInput[] }) => Promise<Task>
      update: (
        taskId: string,
        stepId: string,
        input: Partial<TaskStep>,
      ) => Promise<Task>
      complete: (
        taskId: string,
        input?: { stepId?: string; notes?: string },
      ) => Promise<TaskStepCompleteResult>
    }
    notes: {
      add: (
        taskId: string,
        input: TaskNoteInput & { kind: 'discovery' | 'decision' },
      ) => Promise<Task>
    }
  }
}
