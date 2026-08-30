export type ContinuumErrorCode =
  | 'WORKSPACE_ERROR'
  | 'VALIDATION_ERROR'
  | 'DATABASE_ERROR'
  | 'NOT_FOUND'

export class ContinuumError extends Error {
  readonly code: ContinuumErrorCode
  readonly operation: string
  readonly context?: Record<string, string>

  constructor(options: {
    code: ContinuumErrorCode
    operation: string
    message: string
    context?: Record<string, string>
    cause?: unknown
  }) {
    super(options.message, { cause: options.cause })
    this.name = 'ContinuumError'
    this.code = options.code
    this.operation = options.operation
    this.context = options.context
  }
}

export class WorkspaceConflictError extends ContinuumError {
  constructor(options: {
    workspacePath: string
    alias: string
    cause?: unknown
  }) {
    super({
      code: 'WORKSPACE_ERROR',
      operation: 'resolve workspace',
      message:
        'The workspace path and Git remote aliases resolve to different Continuum workspaces.',
      context: {
        workspacePath: options.workspacePath,
        conflictingAlias: options.alias,
      },
      cause: options.cause,
    })
    this.name = 'WorkspaceConflictError'
  }
}
