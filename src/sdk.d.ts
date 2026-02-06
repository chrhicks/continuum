export type TaskStatus = 'open' | 'ready' | 'blocked' | 'completed' | 'cancelled' | 'deleted'
export type TaskType = 'epic' | 'feature' | 'bug' | 'investigation' | 'chore'

export interface Task {
	id: string
	title: string
	/**
	 * @name description
	 * @description The description of the task. This should be a short description of the task.
	 * - This should be used to provide a high-level overview of the task and its purpose.
	 * - This should include any relevant context for the task.
	 * Format: Markdown
	 */
	description: string
	intent?: string | null
	plan?: string | null
	status: TaskStatus
	type: TaskType
	parentId: string | null
	blockedBy: string[]
	/**
	 * @name discoveries
	 * @description The discoveries made while working on the task. Discoveries
	 * represet useful knowledge gained from the task. This should be useful to inform
	 * future tasks to avoid problems or improve the product.
	 */
	discoveries: TaskDiscovery[]
	/**
	 * @name decisions
	 * @description The decisions made while working on the task. Includes the decision, the 
	 * rationale for the decision and downstream impact of the decision. This should be useful
	 * to inform future decisions to avoid problems or improve the product.
	 */
	decisions: TaskDecision[]
	/**
	 * @name steps
	 * @description The steps of the task to be executed with all of the 
	 * information needed to complete the task. Includes files, code, verification 
	 * steps, etc. Each step is a separate task that can be completed independently.
	 * 
	 * Format: Markdown
	 */
	steps: TaskStep[]
	createdAt: string
	updatedAt: string
}

export interface TaskNote {
	id: string
	content: string
	rationale?: string | null
	impact?: string | null
	source?: 'user' | 'agent' | 'system' | null
	createdAt: string
	updatedAt: string
}

export type TaskDiscovery = TaskNote
export type TaskDecision = TaskNote

export type TaskStepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped'

export interface TaskStep {
	id: string
	/**
	 * @name status
	 * @description The status of the step.
	 */
	status: TaskStepStatus
	/**
	 * @name position
	 * @description Optional ordering position for the step.
	 */
	position?: number | null
	/**
	 * @name title
	 * @description Short description of the step.	
	 */
	title: string
	/**
	 * @name description
	 * @description Long description of the step. Include specific implementation details,
	 * verification steps, etc.
	 * 
	 * Format: Markdown
	 */
	description: string
}

export interface InitStatus {
	success: boolean
}

export interface ListTasksOptions {
	status?: TaskStatus
	type?: TaskType
	cursor?: string
	limit?: number
	sort?: 'createdAt' | 'updatedAt'
	order?: 'asc' | 'desc'
}

export interface CreateTaskInput {
	title: string
	type: TaskType
	status?: TaskStatus
	intent?: string | null
	description: string
	plan?: string | null
	parentId?: string | null
	blockedBy?: string[] | null
}

export interface TaskStepInput {
	title: string
	description: string
	status?: TaskStepStatus
	position?: number | null
}

export interface TaskNoteInput {
	content: string
	rationale?: string | null
	impact?: string | null
	source?: 'user' | 'agent' | 'system' | null
}

export interface CollectionPatch<TAdd, TUpdate> {
	add?: TAdd[]
	update?: (TUpdate & { id: string })[]
	delete?: string[]
}

export interface ContinuumSDK {
	task: {
		init: () => Promise<InitStatus>
		search: (options: ListTasksOptions = {}) => Promise<Task[]>
		get: (id: string) => Promise<Task | null>
		create: (input: CreateTaskInput) => Promise<Task>
		update: (id: string, input: {
			title?: string
			description?: string
			intent?: string | null
			plan?: string | null
			status?: TaskStatus
			type?: TaskType
			parentId?: string | null
			blockedBy?: string[] | null
			steps?: CollectionPatch<TaskStepInput, Partial<TaskStep>>
			discoveries?: CollectionPatch<TaskNoteInput, Partial<TaskDiscovery>>
			decisions?: CollectionPatch<TaskNoteInput, Partial<TaskDecision>>
		} = {}) => Promise<Task>
		delete: (id: string) => Promise<void>
	}
}
