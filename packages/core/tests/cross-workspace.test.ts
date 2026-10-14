import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ContinuumError,
  createContinuum,
  createContinuumImporter,
} from '@continuum/core'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('workspace listing', () => {
  test('lists every workspace with counts and activity range without registering', () => {
    const context = seededContext()

    const listing = context.continuum.listWorkspaces().workspaces
    expect(listing.map(({ identity }) => identity.value)).toEqual([
      context.beta,
      context.alpha,
      context.empty,
    ])

    const alpha = listing.find(
      ({ identity }) => identity.value === context.alpha,
    )
    expect(alpha).toEqual({
      id: context.alphaId,
      identity: { kind: 'path', value: context.alpha },
      aliases: [{ kind: 'path', value: context.alpha }],
      recordCount: 3,
      currentRecordCount: 2,
      oldestCreatedAt: '2026-01-01T00:00:00.000Z',
      newestCreatedAt: '2026-03-01T00:00:00.000Z',
    })
    expect(listing.at(-1)).toMatchObject({
      recordCount: 0,
      currentRecordCount: 0,
      oldestCreatedAt: null,
      newestCreatedAt: null,
    })

    // Listing is read-only: repeating it creates no workspaces or aliases.
    expect(context.continuum.listWorkspaces().workspaces).toHaveLength(3)
    context.close()
  })

  test('returns an empty list for a database with no workspaces', () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-xws-'))
    temporaryRoots.push(root)
    const continuum = createContinuum({ dataDirectory: join(root, 'data') })
    expect(continuum.listWorkspaces()).toEqual({ workspaces: [] })
    continuum.close()
  })
})

describe('cross-workspace retrieval', () => {
  test('browses all workspaces in one chronology with workspace attribution', () => {
    const context = seededContext()

    const all = context.continuum.search({ allWorkspaces: true })
    expect(all.records.map(({ id }) => id)).toEqual([
      'beta-2',
      'alpha-3',
      'alpha-2',
      'beta-1',
    ])
    expect(all.records.map(({ workspaceId }) => workspaceId)).toEqual([
      context.betaId,
      context.alphaId,
      context.alphaId,
      context.betaId,
    ])

    const history = context.continuum.search({
      allWorkspaces: true,
      includeHistory: true,
    })
    expect(history.records.map(({ id }) => id)).toEqual([
      'beta-2',
      'alpha-3',
      'alpha-2',
      'beta-1',
      'alpha-1',
    ])
    context.close()
  })

  test('pages chronological and relevance searches across workspaces without gaps', () => {
    const context = seededContext()

    for (const query of [undefined, 'evidence']) {
      const whole = context.continuum.search({
        allWorkspaces: true,
        includeHistory: true,
        query,
        limit: 100,
      })
      const paged: string[] = []
      let cursor: string | undefined
      do {
        const page = context.continuum.search({
          allWorkspaces: true,
          includeHistory: true,
          query,
          limit: 2,
          cursor,
        })
        paged.push(...page.records.map(({ id }) => id))
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      expect(paged).toEqual(whole.records.map(({ id }) => id))
      expect(paged).toHaveLength(5)
    }
    context.close()
  })

  test('ranks relevance across workspaces and honors tag and kind filters', () => {
    const context = seededContext()

    const matches = context.continuum.search({
      allWorkspaces: true,
      query: 'telescope',
    })
    expect(matches.records.map(({ id }) => id).sort()).toEqual([
      'alpha-3',
      'beta-2',
    ])

    const tagged = context.continuum.search({
      allWorkspaces: true,
      tags: ['shared'],
      kinds: ['decision'],
    })
    expect(tagged.records.map(({ id }) => id)).toEqual(['alpha-2', 'beta-1'])
    context.close()
  })

  test('reads chosen workspaces by ID even when the checkout no longer exists', () => {
    const context = seededContext()
    rmSync(context.beta, { recursive: true })

    const betaOnly = context.continuum.search({
      workspaceIds: [context.betaId],
    })
    expect(betaOnly.records.map(({ id }) => id)).toEqual(['beta-2', 'beta-1'])

    const both = context.continuum.search({
      workspaceIds: [context.alphaId, context.betaId, context.alphaId],
    })
    expect(both.records.map(({ id }) => id)).toEqual([
      'beta-2',
      'alpha-3',
      'alpha-2',
      'beta-1',
    ])
    context.close()
  })

  test('rejects unknown workspace IDs and ambiguous or missing scopes', () => {
    const context = seededContext()

    for (const input of [
      { workspaceIds: ['no-such-workspace'] },
      { workspaceIds: [context.alphaId, 'no-such-workspace'] },
    ]) {
      expect(() => context.continuum.search(input)).toThrow(
        expect.objectContaining({
          code: 'NOT_FOUND',
          context: { workspaceId: 'no-such-workspace' },
        }),
      )
    }

    for (const input of [
      {},
      { allWorkspaces: false },
      { workspace: context.alpha, allWorkspaces: true },
      { workspace: context.alpha, workspaceIds: [context.alphaId] },
      { workspaceIds: [context.alphaId], allWorkspaces: true },
      { workspaceIds: [] },
      { workspaceIds: [' '] },
      { workspaceIds: Array.from({ length: 51 }, (_, i) => `id-${i}`) },
    ]) {
      expect(() => context.continuum.search(input)).toThrow(ContinuumError)
      expect(() =>
        context.continuum.get({ ...input, ids: ['alpha-1'] }),
      ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }))
    }
    context.close()
  })

  test('binds cursors to the scope that produced them', () => {
    const context = seededContext()

    const all = context.continuum.search({ allWorkspaces: true, limit: 1 })
    expect(all.nextCursor).not.toBeNull()
    for (const scope of [
      { workspaceIds: [context.alphaId] },
      { workspaceIds: [context.alphaId, context.betaId] },
      { workspace: context.alpha },
    ]) {
      expect(() =>
        context.continuum.search({
          ...scope,
          limit: 1,
          cursor: all.nextCursor as string,
        }),
      ).toThrow(
        expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message:
            'The search cursor is invalid or does not match this search.',
        }),
      )
    }

    // A single-workspace scope is the same scope however it is addressed.
    const byPath = context.continuum.search({
      workspace: context.alpha,
      limit: 1,
    })
    const byId = context.continuum.search({
      workspaceIds: [context.alphaId],
      limit: 1,
      cursor: byPath.nextCursor as string,
    })
    expect(byId.records.map(({ id }) => id)).toEqual(['alpha-2'])
    context.close()
  })

  test('gets exact records across workspaces or inside a chosen scope', () => {
    const context = seededContext()

    const everywhere = context.continuum.get({
      allWorkspaces: true,
      ids: ['beta-1', 'missing', 'alpha-1'],
    })
    expect(everywhere.records.map(({ id }) => id)).toEqual([
      'beta-1',
      'alpha-1',
    ])
    expect(everywhere.records[1]?.supersededBy).toEqual(['alpha-2'])
    expect(everywhere.missingIds).toEqual(['missing'])

    const scoped = context.continuum.get({
      workspaceIds: [context.alphaId],
      ids: ['beta-1', 'alpha-1'],
    })
    expect(scoped.records.map(({ id }) => id)).toEqual(['alpha-1'])
    expect(scoped.missingIds).toEqual(['beta-1'])
    context.close()
  })

  test('keeps path-scoped reads unchanged and attributed', () => {
    const context = seededContext()

    const result = context.continuum.search({ workspace: context.alpha })
    expect(result.records.map(({ id }) => id)).toEqual(['alpha-3', 'alpha-2'])
    expect(
      result.records.every(
        ({ workspaceId }) => workspaceId === context.alphaId,
      ),
    ).toBe(true)
    context.close()
  })
})

function seededContext() {
  const root = mkdtempSync(join(tmpdir(), 'continuum-xws-'))
  temporaryRoots.push(root)
  const dataDirectory = join(root, 'data')
  const alpha = makeDirectory(root, 'alpha')
  const beta = makeDirectory(root, 'beta')
  const empty = makeDirectory(root, 'empty')

  const importer = createContinuumImporter({ dataDirectory })
  const records = [
    [
      'alpha',
      'alpha-1',
      '2026-01-01T00:00:00.000Z',
      'Alpha evidence about guiding.',
      ['alpha'],
      'observation',
      [],
    ],
    [
      'beta',
      'beta-1',
      '2026-02-01T00:00:00.000Z',
      'Beta evidence about focusing.',
      ['shared'],
      'decision',
      [],
    ],
    [
      'alpha',
      'alpha-2',
      '2026-02-15T00:00:00.000Z',
      'Alpha evidence replaces guiding notes.',
      ['shared'],
      'decision',
      ['alpha-1'],
    ],
    [
      'alpha',
      'alpha-3',
      '2026-03-01T00:00:00.000Z',
      'Alpha evidence: the telescope mount drifts.',
      ['alpha'],
      'observation',
      [],
    ],
    [
      'beta',
      'beta-2',
      '2026-03-02T00:00:00.000Z',
      'Beta evidence: telescope focus is stable.',
      ['beta'],
      'observation',
      [],
    ],
  ] as const
  const paths = { alpha, beta }
  for (const [
    workspace,
    id,
    createdAt,
    content,
    tags,
    kind,
    supersedes,
  ] of records) {
    importer.importRecord({
      workspace: paths[workspace],
      id,
      createdAt,
      content,
      tags: [...tags],
      kind,
      supersedes: [...supersedes],
    })
  }
  importer.close()

  const continuum = createContinuum({ dataDirectory })
  continuum.resolveWorkspace(empty)
  const idFor = (path: string) => {
    const found = continuum
      .listWorkspaces()
      .workspaces.find(({ identity }) => identity.value === path)
    if (!found) throw new Error(`workspace not registered: ${path}`)
    return found.id
  }
  return {
    alpha,
    beta,
    empty,
    alphaId: idFor(alpha),
    betaId: idFor(beta),
    continuum,
    close: () => continuum.close(),
  }
}

function makeDirectory(root: string, name: string): string {
  const path = join(root, name)
  mkdirSync(path)
  return path
}
