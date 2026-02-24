import {
  searchRecall,
  type RecallSearchMatch,
  type RecallSearchMode,
} from './index'

export type RecallSearchEvalCategory = 'exact' | 'semantic' | 'negative'

export type RecallSearchEvalCase = {
  id: string
  category: RecallSearchEvalCategory
  query: string
  expectedSessionId?: string
  expectedFile?: string
  note?: string
}

export type RecallSearchEvalModeResult = {
  requestedMode: RecallSearchMode
  mode: 'bm25' | 'semantic' | null
  fallback: boolean
  ok: boolean
  matched: boolean
  rank: number | null
  topFile: string | null
  topSessionId: string | null
  topScore: number | null
  error: string | null
}

export type RecallSearchEvalCaseResult = {
  test: RecallSearchEvalCase
  modeResults: RecallSearchEvalModeResult[]
}

export type RecallSearchEvalModeSummary = {
  total: number
  pass: number
  fail: number
  error: number
  categories: Record<RecallSearchEvalCategory, { pass: number; total: number }>
}

export type RecallSearchEvalSummary = Record<
  RecallSearchMode,
  RecallSearchEvalModeSummary
>

export type RecallSearchEvalRun = {
  summary: RecallSearchEvalSummary
  results: RecallSearchEvalCaseResult[]
}

export type RecallSearchEvalOptions = {
  cases: RecallSearchEvalCase[]
  summaryDir?: string
  limit?: number
  modes?: RecallSearchMode[]
}

type ExpectedTarget =
  | { kind: 'session'; value: string }
  | { kind: 'file'; value: string }

const DEFAULT_EVAL_MODES: RecallSearchMode[] = ['auto', 'bm25', 'semantic']

export function evaluateRecallSearch(
  options: RecallSearchEvalOptions,
): RecallSearchEvalRun {
  const modes = normalizeModes(options.modes)
  const results = options.cases.map((test) => ({
    test,
    modeResults: modes.map((mode) =>
      evaluateMode({
        test,
        mode,
        summaryDir: options.summaryDir,
        limit: options.limit,
      }),
    ),
  }))
  const summary = buildSummary(results, modes)
  return { summary, results }
}

function normalizeModes(modes?: RecallSearchMode[]): RecallSearchMode[] {
  const raw = modes && modes.length > 0 ? modes : DEFAULT_EVAL_MODES
  const allowed: RecallSearchMode[] = ['bm25', 'semantic', 'auto']
  const filtered = raw.filter((mode): mode is RecallSearchMode =>
    allowed.includes(mode),
  )
  return Array.from(new Set(filtered))
}

function evaluateMode(options: {
  test: RecallSearchEvalCase
  mode: RecallSearchMode
  summaryDir?: string
  limit?: number
}): RecallSearchEvalModeResult {
  const expected = resolveExpectedTarget(options.test)
  if (options.test.category !== 'negative' && !expected) {
    return {
      requestedMode: options.mode,
      mode: null,
      fallback: false,
      ok: false,
      matched: false,
      rank: null,
      topFile: null,
      topSessionId: null,
      topScore: null,
      error: 'Missing expected target for evaluation case.',
    }
  }

  try {
    const result = searchRecall({
      query: options.test.query,
      mode: options.mode,
      summaryDir: options.summaryDir,
      limit: options.limit,
    })
    const matchIndex = expected ? findMatchIndex(result.results, expected) : -1
    const matched =
      options.test.category === 'negative'
        ? result.results.length === 0
        : matchIndex !== -1
    const top = result.results[0]
    return {
      requestedMode: options.mode,
      mode: result.mode,
      fallback: result.fallback,
      ok: true,
      matched,
      rank: matchIndex !== -1 ? matchIndex + 1 : null,
      topFile: top?.filePath ?? null,
      topSessionId: top?.sessionId ?? null,
      topScore: typeof top?.score === 'number' ? top.score : null,
      error: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      requestedMode: options.mode,
      mode: null,
      fallback: false,
      ok: false,
      matched: false,
      rank: null,
      topFile: null,
      topSessionId: null,
      topScore: null,
      error: message,
    }
  }
}

function resolveExpectedTarget(
  test: RecallSearchEvalCase,
): ExpectedTarget | null {
  if (test.expectedSessionId && test.expectedSessionId.trim().length > 0) {
    return { kind: 'session', value: test.expectedSessionId.trim() }
  }
  if (test.expectedFile && test.expectedFile.trim().length > 0) {
    return { kind: 'file', value: test.expectedFile.trim() }
  }
  return null
}

function findMatchIndex(
  results: RecallSearchMatch[],
  expected: ExpectedTarget,
): number {
  if (expected.kind === 'session') {
    const token = normalizeSessionId(expected.value)
    return results.findIndex(
      (match) => normalizeSessionId(match.sessionId) === token,
    )
  }

  const token =
    extractSessionToken(expected.value) ?? normalizeForMatch(expected.value)
  return results.findIndex((match) =>
    normalizeForMatch(match.filePath).includes(token),
  )
}

function normalizeSessionId(value: string | null | undefined): string {
  return normalizeForMatch(value ?? '')
}

function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '-')
}

function extractSessionToken(value: string): string | null {
  const normalized = normalizeForMatch(value)
  const match = normalized.match(/ses-[a-z0-9]+/)
  return match ? match[0] : null
}

function buildSummary(
  results: RecallSearchEvalCaseResult[],
  modes: RecallSearchMode[],
): RecallSearchEvalSummary {
  const summary = modes.reduce<RecallSearchEvalSummary>(
    (acc, mode) => ({
      ...acc,
      [mode]: buildEmptyModeSummary(),
    }),
    {} as RecallSearchEvalSummary,
  )

  for (const result of results) {
    const category = result.test.category
    for (const modeResult of result.modeResults) {
      const entry = summary[modeResult.requestedMode]
      entry.total += 1
      entry.categories[category].total += 1
      if (!modeResult.ok) {
        entry.error += 1
        continue
      }
      if (modeResult.matched) {
        entry.pass += 1
        entry.categories[category].pass += 1
      } else {
        entry.fail += 1
      }
    }
  }

  return summary
}

function buildEmptyModeSummary(): RecallSearchEvalModeSummary {
  return {
    total: 0,
    pass: 0,
    fail: 0,
    error: 0,
    categories: {
      exact: { pass: 0, total: 0 },
      semantic: { pass: 0, total: 0 },
      negative: { pass: 0, total: 0 },
    },
  }
}
