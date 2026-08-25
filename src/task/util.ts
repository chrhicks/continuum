import { mkdir, stat } from 'node:fs/promises'
import { continuumDir } from '../db/paths'
import {
  claimStorageAuthority,
  resolveStorageAuthority,
  type ClaimedStorageAuthority,
  type StorageAuthority,
} from '../db/storage-authority'
import { prepareCanonicalDatabase } from '../db/storage'

interface InitStatus {
  pluginDirExists: boolean
  dbFileExists: boolean
  storageAuthority: StorageAuthority
}

export async function dir_exists(directory: string): Promise<boolean> {
  try {
    const info = await stat(directory)
    return info.isDirectory()
  } catch {
    return false
  }
}

async function file_exists(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isFile()
  } catch {
    return false
  }
}

export async function init_status({
  directory,
  readOnly = false,
}: {
  directory: string
  readOnly?: boolean
}): Promise<InitStatus> {
  const pluginDirExists = await dir_exists(continuumDir(directory))
  const storageAuthority = resolveStorageAuthority(
    directory,
    readOnly ? 'read-only' : 'read-write',
  )
  const dbFileExists = await file_exists(storageAuthority.dbPath)

  return {
    pluginDirExists,
    dbFileExists,
    storageAuthority,
  }
}

export async function init_project({
  directory,
}: {
  directory: string
}): Promise<ClaimedStorageAuthority> {
  if (!(await dir_exists(continuumDir(directory)))) {
    await mkdir(continuumDir(directory), { recursive: true })
  }
  const authority = claimStorageAuthority(directory)
  prepareCanonicalDatabase(authority, { initialize: true })
  return authority
}
