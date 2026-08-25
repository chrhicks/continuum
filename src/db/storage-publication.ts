import { closeSync, existsSync, fsyncSync, linkSync, openSync } from 'node:fs'
import { dirname } from 'node:path'

export interface StoragePublicationOperations {
  readonly link: (source: string, destination: string) => void
  readonly exists: (path: string) => boolean
  readonly openDirectory: (path: string) => number
  readonly sync: (descriptor: number) => void
  readonly close: (descriptor: number) => void
}

export type StoragePublicationResult = 'published' | 'existing'

const liveStoragePublicationOperations: StoragePublicationOperations = {
  link: linkSync,
  exists: existsSync,
  openDirectory: (path) => openSync(path, 'r'),
  sync: fsyncSync,
  close: closeSync,
}

export function publishStorageFileWithoutOverwrite(
  staging: string,
  destination: string,
  operations: StoragePublicationOperations = liveStoragePublicationOperations,
): StoragePublicationResult {
  let result: StoragePublicationResult = 'published'
  try {
    operations.link(staging, destination)
  } catch (cause) {
    if (!operations.exists(destination)) throw cause
    result = 'existing'
  }
  syncPublicationDirectory(destination, operations)
  return result
}

function syncPublicationDirectory(
  destination: string,
  operations: StoragePublicationOperations,
): void {
  const descriptor = operations.openDirectory(dirname(destination))
  try {
    operations.sync(descriptor)
  } finally {
    operations.close(descriptor)
  }
}
