import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'

type QmdMode = 'search' | 'query' | 'vsearch'
type TestCategory = 'exact' | 'semantic' | 'negative'

type TestCase = {
  id: string
  category: TestCategory
  query: string
  expectedFile?: string
  note?: string
}

type QmdResult = {
  docid?: string
  score?: number
  file?: string
  title?: string
  snippet?: string
}

type ModeResult = {
  mode: QmdMode
  ok: boolean
  matched: boolean
  rank: number | null
  topFile: string | null
  topScore: number | null
  error: string | null
}

type TestResult = {
  test: TestCase
  modeResults: ModeResult[]
}

type SkipRecord = {
  test: TestCase
  reason: string
}

const args = process.argv.slice(2)
const getFlag = (name: string) => args.includes(name)
const getArgValue = (name: string) => {
  const direct = args.find((arg) => arg.startsWith(`${name}=`))
  if (direct) return direct.split('=').slice(1).join('=')
  const index = args.findIndex((arg) => arg === name)
  if (index !== -1 && args[index + 1]) return args[index + 1]
  return null
}

const resolvePath = (value: string, base?: string) => {
  if (isAbsolute(value)) return value
  return resolve(base ?? process.cwd(), value)
}

const normalizeName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

const buildCollectionName = (repoPath: string, override: string | null) => {
  if (override) return override
  const base = normalizeName(basename(repoPath)) || 'repo'
  const hash = createHash('sha256').update(repoPath).digest('hex').slice(0, 8)
  return `continuum-opencode-${base}-${hash}`
}

const parseModes = (value: string | null): QmdMode[] => {
  const raw = value?.split(',').map((mode) => mode.trim()) ?? [
    'search',
    'query',
  ]
  const allowed: QmdMode[] = ['search', 'query', 'vsearch']
  return raw.filter((mode): mode is QmdMode =>
    allowed.includes(mode as QmdMode),
  )
}

const normalizeExpectedToken = (expectedFile?: string): string | null => {
  if (!expectedFile) return null
  const match = expectedFile.match(/ses_[a-zA-Z0-9]+/)
  const token = match?.[0]
  if (token) return token.replace(/_/g, '-').toLowerCase()
  const file = basename(expectedFile)
  return file.toLowerCase().replace(/_/g, '-')
}

const extractResultFile = (result: QmdResult) => {
  return typeof result.file === 'string' ? result.file : null
}

const matchResult = (result: QmdResult, token: string | null) => {
  if (!token) return false
  const file = extractResultFile(result)
  if (!file) return false
  return file.toLowerCase().includes(token)
}

const parseQmdJson = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed)
    return { results: [] as QmdResult[], error: null as string | null }
  if (trimmed.toLowerCase().includes('no results found')) {
    return { results: [] as QmdResult[], error: null as string | null }
  }

  const start = trimmed.search(/[\[{]/)
  if (start === -1) {
    return {
      results: [] as QmdResult[],
      error: 'non-json output',
    }
  }

  const payload = trimmed.slice(start)
  try {
    const parsed = JSON.parse(payload)
    if (Array.isArray(parsed)) {
      return { results: parsed as QmdResult[], error: null }
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.results)) {
      return { results: parsed.results as QmdResult[], error: null }
    }
    return { results: [] as QmdResult[], error: 'unexpected json shape' }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { results: [] as QmdResult[], error: detail }
  }
}

const buildSearchArgs = (options: {
  mode: QmdMode
  query: string
  collection: string
  limit: number
  minScore: number | null
  all: boolean
  format: 'json'
}) => {
  const args = [
    options.mode,
    options.query,
    '-c',
    options.collection,
    '-n',
    String(options.limit),
    '--json',
  ]
  const withMinScore = options.minScore !== null
  return [
    ...args,
    ...(options.all ? ['--all'] : []),
    ...(withMinScore ? ['--min-score', String(options.minScore)] : []),
  ]
}

const buildRenderArgs = (options: {
  mode: QmdMode
  query: string
  collection: string
  limit: number
  minScore: number | null
  all: boolean
  format: string
  lineNumbers: boolean
  full: boolean
}) => {
  const args = [
    options.mode,
    options.query,
    '-c',
    options.collection,
    '-n',
    String(options.limit),
  ]
  const formatFlag =
    options.format === 'md'
      ? '--md'
      : options.format === 'files'
        ? '--files'
        : options.format === 'csv'
          ? '--csv'
          : options.format === 'xml'
            ? '--xml'
            : options.format === 'json'
              ? '--json'
              : null
  const withMinScore = options.minScore !== null
  return [
    ...args,
    ...(options.all ? ['--all'] : []),
    ...(withMinScore ? ['--min-score', String(options.minScore)] : []),
    ...(options.full ? ['--full'] : []),
    ...(options.lineNumbers ? ['--line-numbers'] : []),
    ...(formatFlag ? [formatFlag] : []),
  ]
}

const runQmd = (command: string, args: string[], cwd: string) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const ok = result.status === 0
  return {
    ok,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    code: result.status ?? null,
    error: result.error ? String(result.error.message ?? result.error) : null,
  }
}

const evaluateMode = (options: {
  mode: QmdMode
  test: TestCase
  collection: string
  limit: number
  minScore: number | null
  all: boolean
  qmdPath: string
  cwd: string
}) => {
  const args = buildSearchArgs({
    mode: options.mode,
    query: options.test.query,
    collection: options.collection,
    limit: options.limit,
    minScore: options.minScore,
    all: options.all,
    format: 'json',
  })
  const result = runQmd(options.qmdPath, args, options.cwd)
  if (!result.ok) {
    return {
      mode: options.mode,
      ok: false,
      matched: false,
      rank: null,
      topFile: null,
      topScore: null,
      error: result.error ?? result.stderr ?? `exit ${result.code}`,
    }
  }

  const parsed = parseQmdJson(result.stdout)
  if (parsed.error) {
    return {
      mode: options.mode,
      ok: false,
      matched: false,
      rank: null,
      topFile: null,
      topScore: null,
      error: parsed.error,
    }
  }

  const results = parsed.results
  const token = normalizeExpectedToken(options.test.expectedFile)
  const matchIndex = results.findIndex((entry) => matchResult(entry, token))
  const topFile = results[0]?.file ?? null
  const topScore =
    typeof results[0]?.score === 'number' ? (results[0]?.score ?? null) : null
  const matched =
    options.test.category !== 'negative'
      ? matchIndex !== -1
      : results.length === 0
  const rank = matchIndex !== -1 ? matchIndex + 1 : null

  return {
    mode: options.mode,
    ok: true,
    matched,
    rank,
    topFile: typeof topFile === 'string' ? topFile : null,
    topScore,
    error: null,
  }
}

const buildSummary = (results: TestResult[], modes: QmdMode[]) => {
  const init = modes.reduce(
    (acc, mode) => ({
      ...acc,
      [mode]: {
        total: 0,
        pass: 0,
        fail: 0,
        error: 0,
        categories: {
          exact: { pass: 0, total: 0 },
          semantic: { pass: 0, total: 0 },
          negative: { pass: 0, total: 0 },
        },
      },
    }),
    {} as Record<
      QmdMode,
      {
        total: number
        pass: number
        fail: number
        error: number
        categories: Record<TestCategory, { pass: number; total: number }>
      }
    >,
  )

  return results.reduce((acc, result) => {
    return result.modeResults.reduce((inner, modeResult) => {
      const entry = inner[modeResult.mode]
      const category = result.test.category
      const updated = {
        ...entry,
        total: entry.total + 1,
        pass: entry.pass + (modeResult.ok && modeResult.matched ? 1 : 0),
        fail: entry.fail + (modeResult.ok && !modeResult.matched ? 1 : 0),
        error: entry.error + (!modeResult.ok ? 1 : 0),
        categories: {
          ...entry.categories,
          [category]: {
            pass:
              entry.categories[category].pass +
              (modeResult.ok && modeResult.matched ? 1 : 0),
            total: entry.categories[category].total + 1,
          },
        },
      }
      return { ...inner, [modeResult.mode]: updated }
    }, acc)
  }, init)
}

const filterTests = (
  tests: TestCase[],
  options: { onlyIds: string[]; category: TestCategory | null },
) => {
  const filtered = options.onlyIds.length
    ? tests.filter((test) => options.onlyIds.includes(test.id))
    : tests
  return options.category
    ? filtered.filter((test) => test.category === options.category)
    : filtered
}

const splitAvailableTests = (tests: TestCase[]) => {
  return tests.reduce(
    (acc, test) => {
      if (test.category === 'negative') {
        return {
          available: [...acc.available, test],
          skipped: acc.skipped,
        }
      }
      if (test.expectedFile && existsSync(test.expectedFile)) {
        return {
          available: [...acc.available, test],
          skipped: acc.skipped,
        }
      }
      return {
        available: acc.available,
        skipped: [
          ...acc.skipped,
          {
            test,
            reason: test.expectedFile
              ? `missing file: ${test.expectedFile}`
              : 'missing expected file',
          },
        ],
      }
    },
    { available: [] as TestCase[], skipped: [] as SkipRecord[] },
  )
}

const renderModeOutput = (options: {
  mode: QmdMode
  test: TestCase
  collection: string
  limit: number
  minScore: number | null
  all: boolean
  format: string
  lineNumbers: boolean
  full: boolean
  qmdPath: string
  cwd: string
}) => {
  const args = buildRenderArgs({
    mode: options.mode,
    query: options.test.query,
    collection: options.collection,
    limit: options.limit,
    minScore: options.minScore,
    all: options.all,
    format: options.format,
    lineNumbers: options.lineNumbers,
    full: options.full,
  })
  const result = runQmd(options.qmdPath, args, options.cwd)
  if (!result.ok) {
    return `Render failed: ${result.error ?? result.stderr ?? 'unknown error'}`
  }
  return result.stdout.trim()
}

const TEST_CASES: TestCase[] = [
  {
    id: 'exact-qmd-oom',
    category: 'exact',
    query: 'ErrorOutOfDeviceMemory qmd',
    expectedFile:
      '/home/chicks/workspaces/opencode/continuum/.continuum/recall/opencode/OPENCODE-SUMMARY-2026-02-13T19-59-52-ses_3a76960f5ffeS2NoI1C9Lm4wUE.md',
  },
  {
    id: 'exact-summary-threshold',
    category: 'exact',
    query: '200000',
    expectedFile:
      '/home/chicks/workspaces/opencode/continuum/.continuum/recall/opencode/OPENCODE-SUMMARY-2026-02-12T22-52-08-ses_3abf20353ffeN6A2TbHf1fSQHj.md',
  },
  {
    id: 'exact-task-step-schema',
    category: 'exact',
    query: 'taskStepsZodSchema',
    expectedFile:
      '/home/chicks/workspaces/opencode/continuum/.continuum/recall/opencode/OPENCODE-SUMMARY-2026-02-11T23-22-08-ses_3b0fce913ffeLRxjJEmSYS1Bbn.md',
  },
  {
    id: 'exact-auto-init',
    category: 'exact',
    query: 'continuum init',
    expectedFile:
      '/home/chicks/workspaces/opencode/continuum/.continuum/recall/opencode/OPENCODE-SUMMARY-2026-02-11T23-22-08-ses_3b0fce913ffeLRxjJEmSYS1Bbn.md',
  },
  {
    id: 'exact-note-source',
    category: 'exact',
    query: 'default note source agent',
    expectedFile:
      '/home/chicks/workspaces/opencode/continuum/.continuum/recall/opencode/OPENCODE-SUMMARY-2026-02-12T00-16-08-ses_3b0cb78adffeoX09YVZuS0YmX0.md',
  },
  {
    id: 'exact-termius-keys',
    category: 'exact',
    query: 'Command Palette',
    expectedFile:
      '/home/chicks/workspaces/opencode/continuum/.continuum/recall/opencode/OPENCODE-SUMMARY-2026-02-12T16-20-11-ses_3ad58dd48ffeqBbktcjRMkGBNW.md',
  },
  {
    id: 'semantic-sell-all',
    category: 'semantic',
    query:
      'Bulk sell everything moved into the inventory panel, dev-only button removed, disabled when no ores.',
    expectedFile:
      '/home/chicks/workspaces/opencode/continuum/.continuum/recall/opencode/OPENCODE-SUMMARY-2026-02-11T01-01-11-ses_3b5c8968effeF9cIGtismCprTD.md',
  },
  {
    id: 'semantic-gold-format',
    category: 'semantic',
    query:
      'Shared gold formatter outputs K/M/B/T and is used in GoldDisplay and gain popups.',
    expectedFile:
      '/home/chicks/workspaces/opencode/continuum/.continuum/recall/opencode/OPENCODE-SUMMARY-2026-02-11T01-14-24-ses_3b5bc7d0cffeajYnyye4Smxemv.md',
  },
  {
    id: 'semantic-hp-scaling',
    category: 'semantic',
    query:
      'Computed mining time-to-clear at depth 50–100 and reduced HP scaling from 1.03 to 1.02.',
    expectedFile:
      '/home/chicks/workspaces/opencode/continuum/.continuum/recall/opencode/OPENCODE-SUMMARY-2026-02-11T01-29-32-ses_3b5aea24bffezWsrHOn3Wt0W4F.md',
  },
  {
    id: 'semantic-agent-findings',
    category: 'semantic',
    query:
      'Aggregate agent test runs: create before init, step vs steps confusion, misuse of --json init.',
    expectedFile:
      '/home/chicks/workspaces/opencode/continuum/.continuum/recall/opencode/OPENCODE-SUMMARY-2026-02-11T02-00-00-ses_3b592bbc3ffeuZGI4h4Yk9aIOH.md',
  },
  {
    id: 'neg-kubernetes',
    category: 'negative',
    query: 'How do I configure Kubernetes ingress with cert-manager for TLS?',
  },
  {
    id: 'neg-oauth',
    category: 'negative',
    query: 'Which session added OAuth login with Google and GitHub?',
  },
  {
    id: 'neg-rust-parser',
    category: 'negative',
    query: 'Where was a Rust parser implemented to replace a legacy regex?',
  },
]

const run = () => {
  if (getFlag('--help')) {
    console.log('opencode-recall-qmd-eval-prototype')
    console.log('')
    console.log(
      'Usage: bun run scripts/opencode-recall-qmd-eval-prototype.ts [options]',
    )
    console.log('')
    console.log('Options:')
    console.log('  --repo <path>        Repo root (default: cwd)')
    console.log('  --collection <name>  qmd collection name override')
    console.log(
      '  --modes <csv>         search,query,vsearch (default: search,query)',
    )
    console.log('  --limit <n>          Top-k results to evaluate (default: 5)')
    console.log('  --min-score <n>      Minimum score filter (optional)')
    console.log(
      '  --all                Return all matches (use with --min-score)',
    )
    console.log('  --qmd <path>          qmd binary (default: qmd)')
    console.log('  --json               Output evaluation JSON')
    console.log('  --list               List test cases')
    console.log('  --only <ids>         Comma-separated test ids to run')
    console.log('  --category <name>    exact | semantic | negative')
    console.log('  --verbose            Print per-test results')
    console.log(
      '  --render <fmt>       Render a single test output (md|files|full|csv|xml|json)',
    )
    console.log('  --render-id <id>     Test id to render (defaults to first)')
    console.log(
      '  --render-mode <mode> search|query|vsearch (defaults to first mode)',
    )
    console.log('  --render-only        Skip evaluation and render output only')
    console.log('  --line-numbers       Add line numbers to render output')
    console.log('  --full               Use --full for render output')
    return
  }

  const repoPath = resolve(process.cwd(), getArgValue('--repo') ?? '.')
  const collection = buildCollectionName(repoPath, getArgValue('--collection'))
  const modes = parseModes(getArgValue('--modes'))
  const limitRaw = getArgValue('--limit')
  const limitCandidate = limitRaw ? Number(limitRaw) : Number.NaN
  const limit = Number.isFinite(limitCandidate) ? limitCandidate : 5
  const minScoreRaw = getArgValue('--min-score')
  const minScoreCandidate = minScoreRaw ? Number(minScoreRaw) : Number.NaN
  const minScore = Number.isFinite(minScoreCandidate) ? minScoreCandidate : null
  const all = getFlag('--all')
  const qmdPath = getArgValue('--qmd') ?? 'qmd'
  const asJson = getFlag('--json')
  const list = getFlag('--list')
  const verbose = getFlag('--verbose')
  const onlyIds = (getArgValue('--only') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  const categoryRaw = getArgValue('--category')
  const category =
    categoryRaw === 'exact' ||
    categoryRaw === 'semantic' ||
    categoryRaw === 'negative'
      ? (categoryRaw as TestCategory)
      : null
  const renderFormat = getArgValue('--render')
  const renderId = getArgValue('--render-id')
  const renderModeRaw = getArgValue('--render-mode')
  const renderMode =
    renderModeRaw === 'search' ||
    renderModeRaw === 'query' ||
    renderModeRaw === 'vsearch'
      ? (renderModeRaw as QmdMode)
      : null
  const renderLineNumbers = getFlag('--line-numbers')
  const renderFull = getFlag('--full')
  const renderOnly = getFlag('--render-only')

  if (list) {
    TEST_CASES.forEach((test) => {
      console.log(`${test.id} [${test.category}] ${test.query}`)
    })
    return
  }

  const tests = filterTests(TEST_CASES, { onlyIds, category })
  const { available, skipped } = splitAvailableTests(tests)

  if (renderFormat && renderOnly) {
    const targetTest =
      (renderId ? tests.find((test) => test.id === renderId) : null) ?? tests[0]
    const targetMode = renderMode ?? modes[0]
    if (!targetTest) {
      throw new Error('No test case available to render.')
    }
    console.log('Render output:')
    console.log(`Test: ${targetTest.id} (${targetMode})`)
    const output = renderModeOutput({
      mode: targetMode,
      test: targetTest,
      collection,
      limit,
      minScore,
      all,
      format: renderFormat,
      lineNumbers: renderLineNumbers,
      full: renderFull,
      qmdPath,
      cwd: repoPath,
    })
    console.log(output)
    return
  }

  const results = available.map((test) => ({
    test,
    modeResults: modes.map((mode) =>
      evaluateMode({
        mode,
        test,
        collection,
        limit,
        minScore,
        all,
        qmdPath,
        cwd: repoPath,
      }),
    ),
  }))

  const summary = buildSummary(results, modes)

  if (asJson) {
    console.log(
      JSON.stringify({ collection, modes, summary, results, skipped }, null, 2),
    )
  } else {
    console.log(`Collection: ${collection}`)
    modes.forEach((mode) => {
      const modeSummary = summary[mode]
      console.log(`Mode: ${mode}`)
      console.log(
        `- pass: ${modeSummary.pass}/${modeSummary.total} (fail: ${modeSummary.fail}, error: ${modeSummary.error})`,
      )
      console.log(
        `- exact: ${modeSummary.categories.exact.pass}/${modeSummary.categories.exact.total}`,
      )
      console.log(
        `- semantic: ${modeSummary.categories.semantic.pass}/${modeSummary.categories.semantic.total}`,
      )
      console.log(
        `- negative: ${modeSummary.categories.negative.pass}/${modeSummary.categories.negative.total}`,
      )
    })

    if (skipped.length > 0) {
      console.log(`Skipped tests: ${skipped.length}`)
      skipped.slice(0, 5).forEach((entry) => {
        console.log(`- ${entry.test.id}: ${entry.reason}`)
      })
    }

    if (verbose) {
      results.forEach((entry) => {
        console.log(`\n${entry.test.id} [${entry.test.category}]`)
        console.log(`Query: ${entry.test.query}`)
        entry.modeResults.forEach((modeResult) => {
          const status = modeResult.ok
            ? modeResult.matched
              ? 'PASS'
              : 'FAIL'
            : 'ERROR'
          const details = modeResult.ok
            ? `rank=${modeResult.rank ?? 'n/a'} top=${modeResult.topFile ?? 'n/a'}`
            : `error=${modeResult.error}`
          console.log(`- ${modeResult.mode}: ${status} (${details})`)
        })
      })
    }
  }

  if (renderFormat) {
    const targetTest =
      (renderId ? tests.find((test) => test.id === renderId) : null) ?? tests[0]
    const targetMode = renderMode ?? modes[0]
    if (targetTest) {
      console.log('\nRender output:')
      console.log(`Test: ${targetTest.id} (${targetMode})`)
      const output = renderModeOutput({
        mode: targetMode,
        test: targetTest,
        collection,
        limit,
        minScore,
        all,
        format: renderFormat,
        lineNumbers: renderLineNumbers,
        full: renderFull,
        qmdPath,
        cwd: repoPath,
      })
      console.log(output)
    }
  }
}

run()
