import { isAbsolute, join, resolve } from 'node:path'

export function resolveRecallPath(value: string, base?: string): string {
  if (isAbsolute(value)) return value
  return resolve(base ?? process.cwd(), value)
}

export function resolveRecallOutputPath(
  dataRoot: string,
  value: string | null,
  defaultFileName: string,
): string {
  if (value) return resolveRecallPath(value)
  return join(dataRoot, 'recall', 'opencode', defaultFileName)
}
