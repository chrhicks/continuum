import { createHash, timingSafeEqual } from 'node:crypto'
import { ContinuumError } from '../errors'

export type RetrievalMode = 'chronological' | 'fts'

export type CursorScope = {
  workspaceId: string
  mode: RetrievalMode
  query: string | null
  tags: string[]
  kinds: string[]
  includeHistory: boolean
}

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
  recordRowid: number,
): string {
  const cursor = canonicalCursor(scope, recordRowid)
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeRetrievalCursor(
  value: string,
  expectedScope: CursorScope,
): number {
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
      !isObject(cursor.p) ||
      !hasExactKeys(cursor.p, ['n'])
    ) {
      throw new Error('unsupported cursor')
    }
    const recordRowid = cursor.p.n
    if (
      typeof recordRowid !== 'number' ||
      !Number.isSafeInteger(recordRowid) ||
      recordRowid < 1
    ) {
      throw new Error('bad cursor anchor')
    }

    const canonical = canonicalCursor(expectedScope, recordRowid)
    if (!safeEqual(cursor.s, canonical.s)) {
      throw new Error('cursor integrity mismatch')
    }
    if (bytes.toString('utf8') !== JSON.stringify(canonical)) {
      throw new Error('noncanonical cursor JSON')
    }

    return recordRowid
  } catch (cause) {
    if (cause instanceof ContinuumError) throw cause
    throw invalidCursor(cause)
  }
}

function canonicalCursor(
  scope: CursorScope,
  recordRowid: number,
): EncodedCursor {
  return {
    v: cursorVersion,
    m: scope.mode,
    s: hashScopeAndAnchor(scope, recordRowid),
    p: { n: recordRowid },
  }
}

function hashScopeAndAnchor(scope: CursorScope, recordRowid: number): string {
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
        recordRowid,
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
