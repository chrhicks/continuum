import {
  RECALL_SUMMARY_KEYWORD_GROUPS,
  type RecallSummaryConfidence,
  type RecallSummaryKeywordBlock,
} from '../opencode/summary-schema'

export function renderSummaryList(items: string[]): string[] {
  if (items.length === 0) {
    return ['- none']
  }
  return items.map((item) => `- ${item}`)
}

export function renderKeywordList(
  keywords: RecallSummaryKeywordBlock | undefined,
): string[] {
  if (!keywords || countKeywords(keywords) === 0) {
    return ['- none']
  }

  return RECALL_SUMMARY_KEYWORD_GROUPS.flatMap((group) => {
    const values = keywords[group]
    if (values.length === 0) {
      return []
    }
    return [`- ${group}: ${values.join(', ')}`]
  })
}

export function countKeywords(
  keywords: RecallSummaryKeywordBlock | undefined,
): number {
  if (!keywords) {
    return 0
  }
  return RECALL_SUMMARY_KEYWORD_GROUPS.reduce(
    (total, group) => total + keywords[group].length,
    0,
  )
}

export function dedupeStrings(items: string[]): string[] {
  const output: string[] = []
  for (const item of items) {
    const normalized = normalizeWhitespace(item)
    if (!normalized || output.includes(normalized)) {
      continue
    }
    output.push(normalized)
  }
  return output
}

export function normalizeKeywords(
  keywords: RecallSummaryKeywordBlock | undefined,
  allowedFiles: Set<string>,
): RecallSummaryKeywordBlock | undefined {
  if (!keywords) {
    return undefined
  }

  const normalized = Object.fromEntries(
    RECALL_SUMMARY_KEYWORD_GROUPS.map((group) => [
      group,
      group === 'files'
        ? dedupeStrings(keywords[group]).filter((file) =>
            allowedFiles.has(file),
          )
        : dedupeStrings(keywords[group]),
    ]),
  ) as RecallSummaryKeywordBlock

  return countKeywords(normalized) > 0 ? normalized : undefined
}

export function normalizeConfidence(
  value: RecallSummaryConfidence,
): RecallSummaryConfidence {
  if (value === 'low' || value === 'med' || value === 'high') {
    return value
  }
  return 'low'
}

export function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
