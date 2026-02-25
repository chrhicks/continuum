/**
 * Extract the first JSON object from an LLM response string.
 *
 * LLMs sometimes wrap JSON in markdown fences or prepend explanation text
 * even when instructed not to. This function finds the outermost {...}
 * block and returns it as a raw string ready for JSON.parse().
 */
export function extractJsonObject(content: string): string {
  const trimmed = content.trim()

  // Fast path: the whole string is already a clean object
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed
  }

  // Strip markdown fences if present: ```json\n{...}\n```
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n?```/)
  if (fenceMatch?.[1]) {
    const inner = fenceMatch[1].trim()
    if (inner.startsWith('{') && inner.endsWith('}')) {
      return inner
    }
  }

  // Fall back to finding the outermost braces
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('LLM response does not contain a JSON object.')
  }
  return trimmed.slice(start, end + 1)
}

/**
 * Parse a JSON object from an LLM response and validate it.
 *
 * The validate callback receives the raw parsed value and should either
 * return a typed result or throw a descriptive Error if the shape is wrong.
 *
 * @example
 * const result = parseJsonResponse(response.content, (raw) => {
 *   if (!raw || typeof raw !== 'object') throw new Error('Expected object')
 *   const rec = raw as Record<string, unknown>
 *   if (typeof rec.focus !== 'string') throw new Error('Missing focus')
 *   return rec as MySummary
 * })
 */
export function parseJsonResponse<T>(
  content: string,
  validate: (raw: unknown) => T,
): T {
  const json = extractJsonObject(content)

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse LLM JSON response: ${detail}`)
  }

  return validate(parsed)
}
