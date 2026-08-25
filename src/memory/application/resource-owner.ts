import type { DbHandle } from '../../db/client'

export type MemoryResourcePaths = {
  readonly workspaceRoot: string
  readonly memoryDir: string
  readonly dbPath: string
}

export type MemoryResourceOwner = MemoryResourcePaths & {
  readonly handle: DbHandle
}

export function memoryResourceOwner(
  paths: MemoryResourcePaths,
  handle: DbHandle,
): MemoryResourceOwner {
  return { ...paths, handle }
}
