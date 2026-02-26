import { mkdir, stat } from 'node:fs/promises'
import { dbFilePath, continuumDir } from '../db/paths'
import { migrateDb } from '../db/migrate'

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
}: {
  directory: string
}): Promise<InitStatus> {
  const pluginDirExists = await dir_exists(continuumDir(directory))
  const dbFileExists = await file_exists(dbFilePath(directory))

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
  const { pluginDirExists, dbFileExists } = await init_status({ directory })

  if (!pluginDirExists) {
    await mkdir(continuumDir(directory), { recursive: true })
  }
  if (!dbFileExists) {
    await migrateDb(dbFilePath(directory))
  }
}
