import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const CONTINUUM_DIR = '.continuum'
export const MEMORY_DIR = join(CONTINUUM_DIR, 'memory')

export function ensureMemoryDir(): void {
  mkdirSync(MEMORY_DIR, { recursive: true })
}

export function memoryPath(...segments: string[]): string {
  return join(MEMORY_DIR, ...segments)
}
