export function normalizeLimit(
  value: number,
  label: string,
  context: string,
): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${context} ${label} must be a positive number.`)
  }
  return Math.floor(value)
}
