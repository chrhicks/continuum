import { describe, expect, test } from 'bun:test'
import { ContinuumError } from '@continuum/core'
import {
  decodeRetrievalCursor,
  encodeRetrievalCursor,
  type CursorScope,
} from '../src/memory/retrieval-cursor'

const chronologicalScope: CursorScope = {
  workspaceId: 'workspace-one',
  mode: 'chronological',
  query: null,
  tags: [],
  kinds: [],
  includeHistory: false,
}

const ftsScope: CursorScope = {
  workspaceId: 'workspace-one',
  mode: 'fts',
  query: 'cursor anchor',
  tags: ['cursor'],
  kinds: ['observation'],
  includeHistory: true,
}

describe('retrieval cursor encoding', () => {
  test('round-trips a bounded internal record anchor for each retrieval mode', () => {
    for (const scope of [chronologicalScope, ftsScope]) {
      const cursor = encodeRetrievalCursor(scope, 42)
      expect(cursor.length).toBeLessThan(256)
      expect(decodeRetrievalCursor(cursor, scope)).toBe(42)
    }
  })

  test('binds chronological and FTS anchors into the cursor integrity digest', () => {
    for (const scope of [chronologicalScope, ftsScope]) {
      const cursor = encodeRetrievalCursor(scope, 42)
      const decoded = decodeJson(cursor)
      const position = decoded.p as Record<string, unknown>
      position.n = 43
      expectInvalid(encodeJson(decoded), scope)
    }
  })

  test('rejects noncanonical JSON, extra fields, and unsupported versions', () => {
    const cursor = encodeRetrievalCursor(chronologicalScope, 42)
    const decoded = decodeJson(cursor)

    const reordered = {
      m: decoded.m,
      v: decoded.v,
      s: decoded.s,
      p: decoded.p,
    }
    expectInvalid(encodeJson(reordered), chronologicalScope)
    expectInvalid(
      Buffer.from(JSON.stringify(decoded, null, 2), 'utf8').toString(
        'base64url',
      ),
      chronologicalScope,
    )
    expectInvalid(encodeJson({ ...decoded, extra: true }), chronologicalScope)
    expectInvalid(
      encodeJson({ ...decoded, p: { n: 42, extra: true } }),
      chronologicalScope,
    )
    expectInvalid(encodeJson({ ...decoded, v: 2 }), chronologicalScope)
  })

  test('rejects malformed anchors and changed scope, mode, or workspace', () => {
    const cursor = encodeRetrievalCursor(ftsScope, 42)
    const decoded = decodeJson(cursor)
    for (const value of [0, -1, 1.5, '42', null]) {
      expectInvalid(encodeJson({ ...decoded, p: { n: value } }), ftsScope)
    }
    expectInvalid(cursor, { ...ftsScope, query: 'different' })
    expectInvalid(cursor, { ...ftsScope, mode: 'chronological' })
    expectInvalid(cursor, { ...ftsScope, workspaceId: 'workspace-two' })
  })
})

function decodeJson(cursor: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(cursor, 'base64url').toString('utf8'),
  ) as Record<string, unknown>
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function expectInvalid(cursor: string, scope: CursorScope): void {
  let caught: unknown
  try {
    decodeRetrievalCursor(cursor, scope)
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(ContinuumError)
  expect(caught).toMatchObject({
    code: 'VALIDATION_ERROR',
    operation: 'search memory',
  })
}
