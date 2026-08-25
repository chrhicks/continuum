import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { Schema } from 'effect'
import { migrationFailure, workspaceCollision } from './storage-errors'
import { writeDurably } from './storage-snapshot'
import { readWorkspaceIdentity, WorkspaceIdSchema } from './workspace-identity'

const WORKSPACE_CLAIM_VERSION = 1
const LOCK_TIMEOUT_MS = 5_000
const STALE_LOCK_MS = 30_000
const LOCK_POLL_MS = 10
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4))

const WorkspaceClaimSchema = Schema.Struct({
  version: Schema.Literal(WORKSPACE_CLAIM_VERSION),
  id: WorkspaceIdSchema,
  workspacePath: Schema.NonEmptyString,
})

interface WorkspaceClaim extends Schema.Schema.Type<
  typeof WorkspaceClaimSchema
> {}

export function workspaceClaimPath(id: string, dataHome: string): string {
  return join(dataHome, 'continuum', 'workspaces', `${id}.json`)
}

export function workspaceClaimExists(id: string, dataHome: string): boolean {
  return existsSync(workspaceClaimPath(id, dataHome))
}

export function assertWorkspaceClaim(
  id: string,
  workspacePath: string,
  dataHome: string,
): void {
  const path = workspaceClaimPath(id, dataHome)
  if (!existsSync(path)) return
  const claim = readWorkspaceClaim(path, id)
  if (claim.workspacePath === workspacePath) return
  if (isLiveWorkspaceClaim(claim)) {
    throw workspaceCollision(claim.workspacePath, workspacePath)
  }
}

export function claimWorkspaceIdentity(
  id: string,
  workspacePath: string,
  dataHome: string,
): void {
  const path = workspaceClaimPath(id, dataHome)
  mkdirSync(dirname(path), { recursive: true })
  withWorkspaceClaimLock(path, () => {
    const existing = existsSync(path) ? readWorkspaceClaim(path, id) : null
    if (
      existing &&
      existing.workspacePath !== workspacePath &&
      isLiveWorkspaceClaim(existing)
    ) {
      throw workspaceCollision(existing.workspacePath, workspacePath)
    }
    if (existing?.workspacePath === workspacePath) return
    publishWorkspaceClaim(path, { version: 1, id, workspacePath })
  })
}

function readWorkspaceClaim(path: string, expectedId: string): WorkspaceClaim {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const claim = Schema.decodeUnknownSync(WorkspaceClaimSchema)(value)
    if (claim.id !== expectedId) {
      throw new Error(`expected workspace ID ${expectedId}`)
    }
    return claim
  } catch (cause) {
    throw migrationFailure(
      `Workspace identity claim is unreadable: ${path}`,
      cause,
    )
  }
}

function isLiveWorkspaceClaim(claim: WorkspaceClaim): boolean {
  if (!existsSync(claim.workspacePath)) return false
  try {
    return readWorkspaceIdentity(claim.workspacePath)?.id === claim.id
  } catch {
    return true
  }
}

function publishWorkspaceClaim(path: string, claim: WorkspaceClaim): void {
  const staging = `${path}.${process.pid}-${randomUUID()}.tmp`
  writeDurably(staging, `${JSON.stringify(claim, null, 2)}\n`)
  try {
    renameSync(staging, path)
  } catch (cause) {
    throw migrationFailure(
      `Unable to publish workspace identity claim: ${path}`,
      cause,
    )
  } finally {
    if (existsSync(staging)) unlinkSync(staging)
  }
}

function withWorkspaceClaimLock(path: string, operation: () => void): void {
  const lockPath = `${path}.lock`
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  while (!tryAcquireLock(lockPath)) {
    breakStaleLock(lockPath)
    if (Date.now() >= deadline) {
      throw migrationFailure(
        `Timed out waiting for workspace identity claim: ${path}`,
      )
    }
    Atomics.wait(sleepBuffer, 0, 0, LOCK_POLL_MS)
  }
  try {
    operation()
  } finally {
    rmSync(lockPath, { recursive: true, force: true })
  }
}

function tryAcquireLock(lockPath: string): boolean {
  try {
    mkdirSync(lockPath, { mode: 0o700 })
    return true
  } catch (cause) {
    if (isAlreadyExists(cause)) return false
    throw migrationFailure(
      `Unable to lock workspace identity claim: ${lockPath}`,
      cause,
    )
  }
}

function breakStaleLock(lockPath: string): void {
  try {
    if (Date.now() - statSync(lockPath).mtimeMs > STALE_LOCK_MS) {
      rmSync(lockPath, { recursive: true, force: true })
    }
  } catch {
    // Another contender released the lock between inspection and cleanup.
  }
}

function isAlreadyExists(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    cause.code === 'EEXIST'
  )
}
