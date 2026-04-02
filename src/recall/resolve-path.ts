import { isAbsolute, resolve } from 'node:path'

export function resolveRecallPath(value: string, base?: string): string {
  if (isAbsolute(value)) return value
  return resolve(base ?? process.cwd(), value)
}
