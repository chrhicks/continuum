export function parsePositiveInteger(
  value: string,
  errorMessage: string,
): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(errorMessage)
  }
  return parsed
}

export function parseOptionalPositiveInteger(
  value: string | undefined,
  defaultValue: number,
  errorMessage: string,
): number
export function parseOptionalPositiveInteger(
  value: string | undefined,
  defaultValue: null,
  errorMessage: string,
): number | null
export function parseOptionalPositiveInteger(
  value: string | undefined,
  defaultValue: number | null,
  errorMessage: string,
): number | null {
  if (!value) return defaultValue
  return parsePositiveInteger(value, errorMessage)
}
