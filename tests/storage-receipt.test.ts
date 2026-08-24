import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMigrationReceipt } from '../src/db/storage-receipt'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
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
