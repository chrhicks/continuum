import { normalizePositiveLimit } from '../util'

export function normalizeLimit(
  value: number,
  label: string,
  context: string,
): number {
  return normalizePositiveLimit(value, { label, context })
}
