import { createLlmClient } from '../llm/client'
import { parseJsonResponse } from '../llm/json'
import type { ConsolidationLlmConfig } from './config'

/**
 * Structured summary produced either by an LLM or the mechanical fallback.
 * consolidate.ts consumes this shape regardless of which path produced it.
 */
export type NowSummary = {
  /** Multi-sentence narrative of what happened and why */
  narrative: string
  /** Decisions made with brief reasoning each */
  decisions: string[]
  /** Things that were surprising or newly understood */
  discoveries: string[]
  /** Approaches that succeeded and are worth repeating */
  whatWorked: string[]
  /** Approaches tried and abandoned, with why */
  whatFailed: string[]
  /** Unresolved questions to carry into the next session */
  openQuestions: string[]
  /** Concrete follow-on work */
  nextSteps: string[]
  /** Task IDs referenced in the session */
  tasks: string[]
  /** Source path list (kept for index/search purposes) */
  files: string[]
}

// ---------------------------------------------------------------------------
// LLM path
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You summarize the work recorded in a Continuum NOW file.

A NOW file is an append log written by an AI coding agent during a session.
Entries are structured task-loop records with fields like:
  Goal alignment: ...
  Task: ...
  Step: ...
  Changes: ...
  Tests: ...
  Outcome: ...

Return JSON only. No markdown, no backticks, no fences.

Required keys (in this order):
  narrative       - 2-4 sentence paragraph synthesising what was done and why.
                    Write prose, not bullet points. Explain the intent and the
                    reasoning behind the approach, not just the fact that files changed.
  decisions       - array of strings. Each is a decision made during the session
                    with a brief "because..." clause. Only include real choices
                    between alternatives. Empty array if none.
  discoveries     - array of strings. Each is something that was surprising,
                    non-obvious, or newly understood. Empty array if none.
  whatWorked      - array of strings. Approaches that succeeded and are worth
                    repeating. Empty array if nothing notable.
  whatFailed      - array of strings. Approaches tried and abandoned, with why.
                    Empty array if nothing failed.
  openQuestions   - array of strings. Unresolved questions or risks to watch.
                    Empty array if none.
  nextSteps       - array of strings. Concrete follow-on work stated or implied.
                    Empty array if none.
  tasks           - array of task IDs (tkt-* or tkt_*) mentioned. Empty array if none.
  files           - array of source file paths explicitly mentioned in Changes fields.
                    Only real paths, no guesses. Empty array if none.

Rules:
- Use only facts present in the NOW content. Do not invent.
- narrative must be prose paragraphs, not a list.
- Each array item is a complete sentence or phrase, not a fragment.
- Prefer specific over vague: "used session IDs in MEMORY frontmatter for dedup
  because file hashes break on regeneration" beats "improved deduplication".
- If the session content is sparse or unclear, write a short honest narrative
  and return empty arrays for most fields.`

export async function summarizeNow(
  body: string,
  llmConfig: ConsolidationLlmConfig,
): Promise<NowSummary> {
  const client = createLlmClient({
    apiUrl: llmConfig.api_url,
    apiKey: llmConfig.api_key,
    model: llmConfig.model,
    maxTokens: llmConfig.max_tokens,
    timeoutMs: llmConfig.timeout_ms,
  })

  const response = await client.callWithRetry({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `NOW file content:\n\n${body}` },
    ],
  })

  return parseJsonResponse(response.content, validateNowSummary)
}

function validateNowSummary(raw: unknown): NowSummary {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Summary response is not an object.')
  }
  const r = raw as Record<string, unknown>
  return {
    narrative: requireString(r, 'narrative'),
    decisions: requireStringArray(r, 'decisions'),
    discoveries: requireStringArray(r, 'discoveries'),
    whatWorked: requireStringArray(r, 'whatWorked'),
    whatFailed: requireStringArray(r, 'whatFailed'),
    openQuestions: requireStringArray(r, 'openQuestions'),
    nextSteps: requireStringArray(r, 'nextSteps'),
    tasks: requireStringArray(r, 'tasks'),
    files: requireStringArray(r, 'files'),
  }
}

function requireString(rec: Record<string, unknown>, key: string): string {
  if (typeof rec[key] !== 'string') {
    throw new Error(`Summary field "${key}" must be a string.`)
  }
  return (rec[key] as string).trim()
}

function requireStringArray(
  rec: Record<string, unknown>,
  key: string,
): string[] {
  if (!Array.isArray(rec[key])) {
    throw new Error(`Summary field "${key}" must be an array.`)
  }
  return (rec[key] as unknown[]).map((item, i) => {
    if (typeof item !== 'string') {
      throw new Error(`Summary field "${key}[${i}]" must be a string.`)
    }
    return item.trim()
  })
}

// ---------------------------------------------------------------------------
// Mechanical fallback
// ---------------------------------------------------------------------------

const FILE_PATTERN =
  /\b[\w./-]+\.(ts|tsx|js|jsx|json|md|yaml|yml|sql|sh|go|py|rs)\b/gi

export function mechanicalSummary(body: string): NowSummary {
  return {
    narrative: extractNarrative(body),
    decisions: extractMarkers(body, /@decision\b[:\s-]*(.+)/i),
    discoveries: extractMarkers(body, /@discovery\b[:\s-]*(.+)/i),
    whatWorked: [],
    whatFailed: [],
    openQuestions: [],
    nextSteps: [],
    tasks: extractTasks(body),
    files: extractFiles(body),
  }
}

function extractNarrative(body: string): string {
  // Prefer Goal alignment lines, then first ## User: line
  const goalMatch = body.match(/^\s*[-*]?\s*Goal alignment\s*:\s*(.+)$/im)
  if (goalMatch?.[1]) {
    return goalMatch[1].trim()
  }
  const userMatch = body.match(/^## User:\s*(.+)$/m)
  if (userMatch?.[1]) {
    return userMatch[1].trim()
  }
  return 'No summary available.'
}

function extractMarkers(body: string, pattern: RegExp): string[] {
  const results: string[] = []
  for (const line of body.split('\n')) {
    const match = line.match(pattern)
    if (match?.[1]) {
      results.push(match[1].trim())
    }
  }
  return unique(results)
}

function extractTasks(body: string): string[] {
  return unique(body.match(/\btkt[-_][a-zA-Z0-9_-]+\b/g) ?? [])
}

function extractFiles(body: string): string[] {
  // Prefer explicit Changes: lines
  const changes: string[] = []
  for (const line of body.split('\n')) {
    const match = line.match(/^\s*[-*]?\s*Changes:\s*(.+)$/i)
    if (!match?.[1]) continue
    const val = match[1].trim().toLowerCase()
    if (val === 'none' || val === 'n/a') continue
    const found = match[1].match(FILE_PATTERN)
    if (found) changes.push(...found)
  }
  if (changes.length > 0) return unique(changes)
  return unique(body.match(FILE_PATTERN) ?? [])
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items))
}
