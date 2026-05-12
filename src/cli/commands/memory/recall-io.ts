import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { resolveRecallOutputPath } from '../../../recall/resolve-path'

export function resolveRecallPath(
  dataRoot: string,
  value: string | null,
  defaultFileName: string,
): string {
  return resolveRecallOutputPath(dataRoot, value, defaultFileName)
}

export function writeJsonFile(filePath: string, payload: unknown): void {
  ensureParentDirectory(filePath)
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
}

export function appendJsonLine(filePath: string, payload: unknown): void {
  ensureParentDirectory(filePath)
  appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf-8')
}

function ensureParentDirectory(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
}
