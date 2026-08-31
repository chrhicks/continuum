import { Buffer } from 'node:buffer'

export type ContinuumErrorCode =
  | 'WORKSPACE_ERROR'
  | 'VALIDATION_ERROR'
  | 'DATABASE_ERROR'
  | 'NOT_FOUND'

export const maximumSerializedErrorLength = 4_096

const maximumErrorCodeLength = 64
const maximumErrorOperationLength = 128
const maximumErrorMessageLength = 384
const maximumErrorContextValueLength = 512
const safeContextKeys = new Set([
  'workspacePath',
  'recordId',
  'conflictingAlias',
  'databasePath',
  'dataDirectory',
])

export function serializeSafeError(error: {
  code: string
  operation: string
  message: string
  context?: Record<string, string>
}): string {
  const boundedError = {
    code: truncate(error.code, maximumErrorCodeLength),
    operation: truncate(error.operation, maximumErrorOperationLength),
    message: truncate(error.message, maximumErrorMessageLength),
    ...safeErrorContext(error.context),
  }
  let serialized = JSON.stringify({ error: boundedError })
  if (isWithinErrorLimit(serialized)) return serialized

  const withoutContext = { ...boundedError, context: undefined }
  serialized = JSON.stringify({ error: withoutContext })
  if (isWithinErrorLimit(serialized)) return serialized

  return JSON.stringify({
    error: {
      code: 'DATABASE_ERROR',
      operation: 'serialize error',
      message: 'Continuum could not safely serialize the operation failure.',
    },
  })
}

function isWithinErrorLimit(serialized: string): boolean {
  return (
    serialized.length <= maximumSerializedErrorLength &&
    Buffer.byteLength(serialized, 'utf8') <= maximumSerializedErrorLength
  )
}

function safeErrorContext(context: Record<string, string> | undefined): {
  context?: Record<string, string>
} {
  if (!context) return {}
  const entries = Object.entries(context)
    .filter(([key]) => safeContextKeys.has(key))
    .map(([key, value]) => [
      key,
      truncate(value, maximumErrorContextValueLength),
    ])
  return entries.length > 0 ? { context: Object.fromEntries(entries) } : {}
}

function truncate(value: string, maximumLength: number): string {
  return value.length <= maximumLength
    ? value
    : `${value.slice(0, maximumLength - 1)}…`
}

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
