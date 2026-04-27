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
import { resolveMemoryDir } from './paths'

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

type AtomicBackup = { path: string; backupPath: string }
type AtomicRotation = { from: string; to: string }

export function writeFilesAtomically(targets: AtomicWriteTarget[]): void {
  const tempPaths = writeTempTargets(targets)
  const rotations: AtomicRotation[] = []
  const backups: AtomicBackup[] = []

  try {
    rotateExistingTargets(targets, rotations)
    backupExistingTargets(targets, backups)
    commitTempTargets(targets, tempPaths)
  } catch (error) {
    rollbackAtomicWrite(tempPaths, backups, rotations)
    throw error
  }
}

function writeTempTargets(targets: AtomicWriteTarget[]): Map<string, string> {
  const tempPaths = new Map<string, string>()
  for (const target of targets) {
    const tempPath = `${target.path}.tmp-${randomSuffix()}`
    writeFileSync(tempPath, target.content, 'utf-8')
    tempPaths.set(target.path, tempPath)
  }
  return tempPaths
}

function rotateExistingTargets(
  targets: AtomicWriteTarget[],
  rotations: AtomicRotation[],
): void {
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
}

function backupExistingTargets(
  targets: AtomicWriteTarget[],
  backups: AtomicBackup[],
): void {
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
}

function commitTempTargets(
  targets: AtomicWriteTarget[],
  tempPaths: Map<string, string>,
): void {
  for (const target of targets) {
    const tempPath = tempPaths.get(target.path)
    if (!tempPath) {
      continue
    }
    renameSync(tempPath, target.path)
  }
}

function rollbackAtomicWrite(
  tempPaths: Map<string, string>,
  backups: AtomicBackup[],
  rotations: AtomicRotation[],
): void {
  cleanupTempPaths(tempPaths)
  restoreBackups(backups)
  restoreRotations(rotations)
}

function cleanupTempPaths(tempPaths: Map<string, string>): void {
  for (const tempPath of tempPaths.values()) {
    if (existsSync(tempPath)) {
      rmSync(tempPath)
    }
  }
}

function restoreBackups(backups: AtomicBackup[]): void {
  for (const { path, backupPath } of backups) {
    if (!existsSync(backupPath)) {
      continue
    }
    const backupContent = readFileSync(backupPath, 'utf-8')
    writeFileSync(path, backupContent, 'utf-8')
  }
}

function restoreRotations(rotations: AtomicRotation[]): void {
  for (const rotation of rotations) {
    if (existsSync(rotation.from) && !existsSync(rotation.to)) {
      renameSync(rotation.from, rotation.to)
    }
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
  logEntry: { entry: string; timestamp: string } | string,
  rotationLines: number,
  existingContent?: string | null,
): { content: string; rotateExistingTo?: string } {
  let existing = ''
  let rotateExistingTo: string | undefined
  const currentContent =
    typeof existingContent === 'string'
      ? existingContent
      : existsSync(path)
        ? readFileSync(path, 'utf-8')
        : null

  if (currentContent !== null) {
    const content = currentContent
    const lineCount = content.split('\n').length
    if (lineCount > rotationLines) {
      rotateExistingTo = `${path}.old`
    } else {
      existing = content
    }
  }
  const entry = typeof logEntry === 'string' ? logEntry : logEntry.entry
  return { content: existing + entry + '\n', rotateExistingTo }
}

export function cleanupOldNowFiles(
  activeNowPath: string,
  retentionDays: number,
): string[] {
  const memoryDir = resolveMemoryDir()
  if (!existsSync(memoryDir)) {
    return []
  }

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const activePath = resolve(activeNowPath)
  const removed: string[] = []

  for (const fileName of readdirSync(memoryDir)) {
    if (!/^NOW-.*\.md$/.test(fileName)) {
      continue
    }
    const filePath = join(memoryDir, fileName)
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
