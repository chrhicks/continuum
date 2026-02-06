export type ContinuumErrorCode =
  | 'NOT_INITIALIZED'
  | 'TASK_NOT_FOUND'
  | 'INVALID_STATUS'
  | 'TASK_CREATE_FAILED'
  | 'TASK_UPDATE_FAILED'
  | 'NO_CHANGES_MADE'
  | 'HAS_BLOCKERS'
  | 'INVALID_TYPE'
  | 'INVALID_TEMPLATE'
  | 'PARENT_NOT_FOUND'
  | 'ITEM_NOT_FOUND'
  | 'BLOCKER_NOT_FOUND'
  | 'INVALID_BLOCKER'
  | 'DUPLICATE_BLOCKERS'

export class ContinuumError extends Error {
  code: ContinuumErrorCode
  suggestions?: string[]
  constructor(
    code: ContinuumErrorCode,
    message: string,
    suggestions?: string[],
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.code = code
    this.suggestions = suggestions
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function isContinuumError(err: unknown): err is ContinuumError {
  return err instanceof ContinuumError
}
