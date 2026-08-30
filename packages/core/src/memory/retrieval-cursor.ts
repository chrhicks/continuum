import { createHash, timingSafeEqual } from 'node:crypto'
import { ContinuumError } from '../errors'
import { isCanonicalMemoryTimestamp } from './records'

export type RetrievalMode = 'chronological' | 'fts'

export type CursorScope = {
  workspaceId: string
  mode: RetrievalMode
  query: string | null
  tags: string[]
  kinds: string[]
  includeHistory: boolean
}

export type CursorPosition =
  | { mode: 'chronological'; createdAt: string; id: string }
  | { mode: 'fts'; score: number; createdAt: string; id: string }

type EncodedCursor = {
  v: number
  m: RetrievalMode
  s: string
  p: Record<string, unknown>
}

const cursorVersion = 1
export const maximumCursorLength = 4_096

export function encodeRetrievalCursor(
  scope: CursorScope,
  position: CursorPosition,
): string {
  const cursor: EncodedCursor = {
    v: cursorVersion,
    m: scope.mode,
    s: hashScope(scope),
    p:
      position.mode === 'chronological'
        ? { t: position.createdAt, id: position.id }
        : { r: position.score, t: position.createdAt, id: position.id },
  }
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeRetrievalCursor(
  value: string,
  expectedScope: CursorScope,
): CursorPosition {
  try {
    if (
      !value ||
      value.length > maximumCursorLength ||
      !/^[A-Za-z0-9_-]+$/.test(value)
    ) {
      throw new Error('invalid base64url')
    }

    const bytes = Buffer.from(value, 'base64url')
    if (bytes.toString('base64url') !== value) {
      throw new Error('noncanonical base64url')
    }
    const decoded: unknown = JSON.parse(bytes.toString('utf8'))
    if (!isObject(decoded) || !hasExactKeys(decoded, ['v', 'm', 's', 'p'])) {
      throw new Error('invalid cursor object')
    }

    const cursor = decoded as EncodedCursor
    if (
      cursor.v !== cursorVersion ||
      cursor.m !== expectedScope.mode ||
      typeof cursor.s !== 'string' ||
      !/^[a-f0-9]{64}$/.test(cursor.s) ||
      !isObject(cursor.p)
    ) {
      throw new Error('unsupported cursor')
    }
    const expectedHash = hashScope(expectedScope)
    if (!safeEqual(cursor.s, expectedHash)) {
      throw new Error('cursor scope mismatch')
    }

    if (cursor.m === 'chronological') {
      if (!hasExactKeys(cursor.p, ['t', 'id'])) throw new Error('bad position')
      const createdAt = cursor.p.t
      const id = cursor.p.id
      if (
        typeof createdAt !== 'string' ||
        !isCanonicalMemoryTimestamp(createdAt) ||
        typeof id !== 'string' ||
        !id
      ) {
        throw new Error('bad position')
      }
      return { mode: 'chronological', createdAt, id }
    }

    if (!hasExactKeys(cursor.p, ['r', 't', 'id'])) {
      throw new Error('bad position')
    }
    const score = cursor.p.r
    const createdAt = cursor.p.t
    const id = cursor.p.id
    if (
      typeof score !== 'number' ||
      !Number.isFinite(score) ||
      typeof createdAt !== 'string' ||
      !isCanonicalMemoryTimestamp(createdAt) ||
      typeof id !== 'string' ||
      !id
    ) {
      throw new Error('bad position')
    }
    return { mode: 'fts', score, createdAt, id }
  } catch (cause) {
    if (cause instanceof ContinuumError) throw cause
    throw invalidCursor(cause)
  }
}

function hashScope(scope: CursorScope): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        cursorVersion,
        scope.workspaceId,
        scope.mode,
        scope.query,
        scope.tags,
        scope.kinds,
        scope.includeHistory,
      ]),
    )
    .digest('hex')
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8')
  const rightBytes = Buffer.from(right, 'utf8')
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: string[],
): boolean {
  const keys = Object.keys(value).sort()
  return (
    keys.length === expected.length &&
    expected
      .slice()
      .sort()
      .every((key, index) => key === keys[index])
  )
}

function invalidCursor(cause?: unknown): ContinuumError {
  return new ContinuumError({
    code: 'VALIDATION_ERROR',
    operation: 'search memory',
    message: 'The search cursor is invalid or does not match this search.',
    cause,
  })
}
