import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { Schema } from 'effect'
import { migrationFailure } from './storage-errors'
import {
  publishStorageFileWithoutOverwrite,
  type StoragePublicationOperations,
} from './storage-publication'
import { writeDurably } from './storage-snapshot'

const WORKSPACE_IDENTITY_FILE = 'workspace.json'
const WORKSPACE_IDENTITY_VERSION = 1

export const WorkspaceIdSchema = Schema.String.check(
  Schema.isPattern(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  ),
)

const WorkspaceIdentitySchema = Schema.Struct({
  version: Schema.Literal(WORKSPACE_IDENTITY_VERSION),
  id: WorkspaceIdSchema,
})

export interface WorkspaceIdentity extends Schema.Schema.Type<
  typeof WorkspaceIdentitySchema
> {}

export function workspaceIdentityPath(directory: string): string {
  return join(directory, '.continuum', WORKSPACE_IDENTITY_FILE)
}

export function readWorkspaceIdentity(
  directory: string,
): WorkspaceIdentity | null {
  const path = workspaceIdentityPath(directory)
  if (!existsSync(path)) return null
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return Schema.decodeUnknownSync(WorkspaceIdentitySchema)(value)
  } catch (cause) {
    throw migrationFailure(`Workspace identity is unreadable: ${path}`, cause)
  }
}

export function ensureWorkspaceIdentity(
  directory: string,
  operations?: StoragePublicationOperations,
): WorkspaceIdentity {
  const existing = readWorkspaceIdentity(directory)
  if (existing) return existing

  const path = workspaceIdentityPath(directory)
  mkdirSync(dirname(path), { recursive: true })
  const identity = makeWorkspaceIdentity()
  const staging = `${path}.${process.pid}-${randomUUID()}.tmp`
  writeDurably(staging, serializeIdentity(identity))
  try {
    const result = publishStorageFileWithoutOverwrite(staging, path, operations)
    if (result === 'published') return identity
    const winner = readWorkspaceIdentity(directory)
    if (!winner) {
      throw migrationFailure(`Workspace identity is unreadable: ${path}`)
    }
    return winner
  } finally {
    if (existsSync(staging)) unlinkSync(staging)
  }
}

export function replaceWorkspaceIdentity(
  directory: string,
  id: string,
): WorkspaceIdentity {
  const path = workspaceIdentityPath(directory)
  if (!existsSync(path)) {
    throw migrationFailure(
      `Cannot fork an uninitialized workspace without identity metadata: ${path}`,
    )
  }
  const identity = Schema.decodeUnknownSync(WorkspaceIdentitySchema)({
    version: WORKSPACE_IDENTITY_VERSION,
    id,
  })
  const staging = `${path}.${process.pid}-${randomUUID()}.fork.tmp`
  writeDurably(staging, serializeIdentity(identity))
  try {
    renameSync(staging, path)
    return identity
  } catch (cause) {
    throw migrationFailure(
      `Unable to replace workspace identity: ${path}`,
      cause,
    )
  } finally {
    if (existsSync(staging)) unlinkSync(staging)
  }
}

export function makeWorkspaceIdentity(): WorkspaceIdentity {
  return {
    version: WORKSPACE_IDENTITY_VERSION,
    id: randomUUID(),
  }
}

function serializeIdentity(identity: WorkspaceIdentity): string {
  return `${JSON.stringify(identity, null, 2)}\n`
}
