/**
 * Atomic file I/O, log helpers, and NOW file cleanup for consolidation.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { MEMORY_DIR } from './paths'

export const LOG_ROTATION_LINES = 1000

export function countLines(content: string): number {
  if (!content) {
    return 0
  }
  return content.split('\n').length
}

export type AtomicWriteTarget = {
  path: string
  content: string
  rotateExistingTo?: string
}

export function writeFilesAtomically(targets: AtomicWriteTarget[]): void {
  const tempPaths = new Map<string, string>()
  const backups: { path: string; backupPath: string }[] = []
  const rotations: { from: string; to: string }[] = []

  try {
    for (const target of targets) {
      const tempPath = `${target.path}.tmp-${randomSuffix()}`
      writeFileSync(tempPath, target.content, 'utf-8')
      tempPaths.set(target.path, tempPath)
    }

    for (const target of targets) {
      if (!target.rotateExistingTo || !existsSync(target.path)) {
        continue
      }
      if (existsSync(target.rotateExistingTo)) {
        rmSync(target.rotateExistingTo)
      }
      renameSync(target.path, target.rotateExistingTo)
      rotations.push({ from: target.rotateExistingTo, to: target.path })
    }

    for (const target of targets) {
      if (!existsSync(target.path)) {
        continue
      }
      const backupPath = `${target.path}.bak`
      if (existsSync(backupPath)) {
        const rotatedBackup = `${backupPath}.old`
        if (existsSync(rotatedBackup)) {
          rmSync(rotatedBackup)
        }
        renameSync(backupPath, rotatedBackup)
      }
      const existingContent = readFileSync(target.path, 'utf-8')
      writeFileSync(backupPath, existingContent, 'utf-8')
      backups.push({ path: target.path, backupPath })
    }

    for (const target of targets) {
      const tempPath = tempPaths.get(target.path)
      if (!tempPath) {
        continue
      }
      renameSync(tempPath, target.path)
    }
  } catch (error) {
    for (const tempPath of tempPaths.values()) {
      if (existsSync(tempPath)) {
        rmSync(tempPath)
      }
    }

    for (const { path, backupPath } of backups) {
      if (!existsSync(backupPath)) {
        continue
      }
      const backupContent = readFileSync(backupPath, 'utf-8')
      writeFileSync(path, backupContent, 'utf-8')
    }

    for (const rotation of rotations) {
      if (existsSync(rotation.from) && !existsSync(rotation.to)) {
        renameSync(rotation.from, rotation.to)
      }
    }

    throw error
  }
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function buildLogEntry(options: {
  nowFile: string
  memoryFile: string
  recentPath: string
  decisions: number
  discoveries: number
  patterns: number
}): { entry: string; timestamp: string } {
  const timestamp = new Date()
    .toISOString()
    .replace('T', ' ')
    .replace('Z', ' UTC')
  const entry = [
    `[${timestamp}] ACTION: Consolidate NOW→RECENT→MEMORY (Marker-based)`,
    '  Files:',
    `    - ${options.nowFile}`,
    `    - ${options.recentPath}`,
    `    - ${options.memoryFile}`,
    `  Extracted: ${options.decisions} decisions, ${options.discoveries} discoveries, ${options.patterns} patterns`,
    '',
  ].join('\n')
  return { entry, timestamp }
}

export function buildUpdatedLog(
  path: string,
  logEntry: { entry: string; timestamp: string },
  rotationLines: number,
): { content: string; rotateExistingTo?: string } {
  let existing = ''
  let rotateExistingTo: string | undefined
  if (existsSync(path)) {
    const content = readFileSync(path, 'utf-8')
    const lineCount = content.split('\n').length
    if (lineCount > rotationLines) {
      rotateExistingTo = `${path}.old`
    } else {
      existing = content
    }
  }
  return { content: existing + logEntry.entry + '\n', rotateExistingTo }
}

export function cleanupOldNowFiles(
  activeNowPath: string,
  retentionDays: number,
): string[] {
  if (!existsSync(MEMORY_DIR)) {
    return []
  }

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const activePath = resolve(activeNowPath)
  const removed: string[] = []

  for (const fileName of readdirSync(MEMORY_DIR)) {
    if (!/^NOW-.*\.md$/.test(fileName)) {
      continue
    }
    const filePath = join(MEMORY_DIR, fileName)
    if (resolve(filePath) === activePath) {
      continue
    }
    const stats = statSync(filePath)
    if (stats.mtimeMs < cutoff) {
      rmSync(filePath)
      removed.push(filePath)
    }
  }

  return removed
}
