import { mkdir, stat } from 'node:fs/promises'
import {
  canonicalDbFilePath,
  continuumDir,
  readOnlyCanonicalDbFilePath,
} from '../db/paths'
import { prepareCanonicalDatabase } from '../db/storage'

interface InitStatus {
  pluginDirExists: boolean
  dbFileExists: boolean
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
  const dbPath = readOnly
    ? readOnlyCanonicalDbFilePath(directory)
    : canonicalDbFilePath(directory)
  const dbFileExists = await file_exists(dbPath)

  return {
    pluginDirExists,
    dbFileExists,
  }
}

export async function init_project({
  directory,
}: {
  directory: string
}): Promise<void> {
  if (!(await dir_exists(continuumDir(directory)))) {
    await mkdir(continuumDir(directory), { recursive: true })
  }
  await prepareCanonicalDatabase(directory, { initialize: true })
}
