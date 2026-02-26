export type NormalizeTagsOptions = {
  trim?: boolean
  dropEmpty?: boolean
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
