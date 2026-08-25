import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  publishStorageFileWithoutOverwrite,
  type StoragePublicationOperations,
} from '../src/db/storage-publication'
import { readMigrationReceipt } from '../src/db/storage-receipt'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('durable storage publication', () => {
  test('links the authoritative name before syncing its directory', () => {
    const events: string[] = []
    const operations: StoragePublicationOperations = {
      link: (source, destination) =>
        events.push(`link:${source}:${destination}`),
      exists: (path) => {
        events.push(`exists:${path}`)
        return false
      },
      openDirectory: (path) => {
        events.push(`open:${path}`)
        return 17
      },
      sync: (descriptor) => events.push(`sync:${descriptor}`),
      close: (descriptor) => events.push(`close:${descriptor}`),
    }

    expect(
      publishStorageFileWithoutOverwrite(
        '/staging/file',
        '/canonical/file',
        operations,
      ),
    ).toBe('published')
    expect(events).toEqual([
      'link:/staging/file:/canonical/file',
      'open:/canonical',
      'sync:17',
      'close:17',
    ])
  })

  test('propagates directory sync errors without undoing publication', () => {
    const events: string[] = []
    let authoritativeNameExists = false
    const operations: StoragePublicationOperations = {
      link: () => {
        authoritativeNameExists = true
        events.push('link')
      },
      exists: () => false,
      openDirectory: () => {
        events.push('open')
        return 23
      },
      sync: () => {
        events.push('sync')
        throw new Error('directory sync failed')
      },
      close: () => events.push('close'),
    }

    expect(() =>
      publishStorageFileWithoutOverwrite(
        '/staging/file',
        '/canonical/file',
        operations,
      ),
    ).toThrow('directory sync failed')
    expect(authoritativeNameExists).toBe(true)
    expect(events).toEqual(['link', 'open', 'sync', 'close'])
  })

  test('syncs an existing authoritative name before idempotent success', () => {
    const events: string[] = []
    const operations: StoragePublicationOperations = {
      link: () => {
        events.push('link')
        throw new Error('already exists')
      },
      exists: () => {
        events.push('exists')
        return true
      },
      openDirectory: () => {
        events.push('open')
        return 29
      },
      sync: () => events.push('sync'),
      close: () => events.push('close'),
    }

    expect(
      publishStorageFileWithoutOverwrite(
        '/staging/file',
        '/canonical/file',
        operations,
      ),
    ).toBe('existing')
    expect(events).toEqual(['link', 'exists', 'open', 'sync', 'close'])
  })
})

describe('migration receipt schema', () => {
  test('rejects malformed nested fingerprints with a typed storage error', () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-receipt-schema-'))
    roots.push(root)
    const path = join(root, 'receipt.json')
    writeFileSync(
      path,
      JSON.stringify({
        version: 2,
        projectId: 'project',
        workspacePath: '/workspace',
        sourcePath: '/legacy.db',
        destinationPath: '/canonical.db',
        sourceFingerprint: {
          algorithm: 'sha256',
          digest: 'not-a-digest',
          byteLength: -1,
        },
        destinationFingerprint: {
          algorithm: 'sha256',
          digest: '0'.repeat(64),
          byteLength: 1,
        },
        migratedAt: '2026-01-01T00:00:00.000Z',
        method: 'sqlite-serialize-snapshot',
      }),
    )

    expect(() => readMigrationReceipt(path)).toThrow(
      expect.objectContaining({ code: 'STORAGE_MIGRATION_FAILED' }),
    )
  })
})
