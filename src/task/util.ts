import { mkdir, stat } from 'node:fs/promises'
import { init_db } from './db'

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
  const pluginDirExists = await dir_exists(`${directory}/.continuum`)
  const dbFileExists = await file_exists(`${directory}/.continuum/continuum.db`)

  return {
    pluginDirExists,
    dbFileExists,
  }
}

export async function init_project({ directory }: { directory: string }) {
  const { pluginDirExists, dbFileExists } = await init_status({ directory })

  if (!pluginDirExists) {
    await mkdir(`${directory}/.continuum`, { recursive: true })
  }
  if (!dbFileExists) {
    await init_db(directory)
  }
}
