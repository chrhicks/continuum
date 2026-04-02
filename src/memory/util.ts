export type NormalizeTagsOptions = {
  trim?: boolean
  dropEmpty?: boolean
}

export type NormalizePositiveLimitOptions = {
  defaultValue?: number
  label?: string
  context?: string
  zeroAsDefault?: boolean
}

export function normalizeTags(
  value: unknown,
  options: NormalizeTagsOptions = {},
): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const trim = options.trim ?? false
  const dropEmpty = options.dropEmpty ?? false
  let tags = value.map((tag) => String(tag))
  if (trim) {
    tags = tags.map((tag) => tag.trim())
  }
  if (dropEmpty) {
    tags = tags.filter((tag) => tag.length > 0)
  }
  return tags
}

export function normalizePositiveLimit(
  value: number | undefined,
  options: NormalizePositiveLimitOptions = {},
): number {
  const {
    defaultValue,
    label = 'Limit',
    context,
    zeroAsDefault = false,
  } = options

  if (defaultValue !== undefined) {
    if (!Number.isFinite(defaultValue) || defaultValue <= 0) {
      throw new Error('Default limit must be a positive number.')
    }
  }

  if (value === undefined || !Number.isFinite(value)) {
    if (defaultValue !== undefined) {
      return Math.floor(defaultValue)
    }
    throw new Error(buildPositiveLimitError(label, context))
  }

  if (value === 0 && zeroAsDefault && defaultValue !== undefined) {
    return Math.floor(defaultValue)
  }

  if (value <= 0) {
    throw new Error(buildPositiveLimitError(label, context))
  }

  return Math.floor(value)
}

function buildPositiveLimitError(label: string, context?: string): string {
  if (!context) {
    return `${label} must be a positive number.`
  }
  return `${context} ${label} must be a positive number.`
}
