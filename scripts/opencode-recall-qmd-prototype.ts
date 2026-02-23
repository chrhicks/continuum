import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'

type QmdMode = 'search' | 'query' | 'vsearch'

type QmdResult = {
  docid?: string
  score?: number
  file?: string
  title?: string
  snippet?: string
}

type CommandSpec = {
  label: string
  command: string
  args: string[]
}

type CommandResult = {
  ok: boolean
  code: number | null
  error: string | null
  stdout: string
  stderr: string
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

const resolveSummaryDir = (repoPath: string, value: string | null): string => {
  if (value) return resolvePath(value, repoPath)
  return join(repoPath, '.continuum', 'recall', 'opencode')
}

const normalizeName = (value: string) => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

const buildCollectionName = (repoPath: string, override: string | null) => {
  if (override) return override
  const base = normalizeName(basename(repoPath)) || 'repo'
  const hash = createHash('sha256').update(repoPath).digest('hex').slice(0, 8)
  return `continuum-opencode-${base}-${hash}`
}

const listSummaryFiles = (summaryDir: string, mask: string) => {
  if (!existsSync(summaryDir)) return []
  if (mask === 'OPENCODE-SUMMARY-*.md') {
    return readdirSync(summaryDir).filter(
      (name) => name.startsWith('OPENCODE-SUMMARY-') && name.endsWith('.md'),
    )
  }
  return readdirSync(summaryDir).filter((name) => name.endsWith('.md'))
}

const ensureSummaryDir = (summaryDir: string, mask: string) => {
  if (!existsSync(summaryDir)) {
    throw new Error(`Summary directory not found: ${summaryDir}`)
  }
  const files = listSummaryFiles(summaryDir, mask)
  if (files.length === 0) {
    throw new Error(
      `No summary files found in ${summaryDir} (mask: ${mask}). Run the recall sync first.`,
    )
  }
}

const formatCommand = (spec: CommandSpec) => {
  const parts = [spec.command, ...spec.args]
  return parts
    .map((part) => (part.includes(' ') ? `"${part}"` : part))
    .join(' ')
}

const runCommand = (spec: CommandSpec, cwd: string) => {
  const result = spawnSync(spec.command, spec.args, {
    cwd,
    stdio: 'inherit',
    shell: false,
  })
  return {
    ok: result.status === 0,
    code: result.status ?? null,
    error: result.error ? String(result.error.message ?? result.error) : null,
  }
}

const runCommandWithOutput = (
  spec: CommandSpec,
  cwd: string,
): CommandResult => {
  const result = spawnSync(spec.command, spec.args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  return {
    ok: result.status === 0,
    code: result.status ?? null,
    error: result.error ? String(result.error.message ?? result.error) : null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
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
    return { results: [] as QmdResult[], error: 'non-json output' }
  }

  try {
    const parsed = JSON.parse(trimmed.slice(start))
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

const outputIndicatesNoResults = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return true
  return trimmed.toLowerCase().includes('no results found')
}

const hasSearchResults = (output: string, json: boolean) => {
  if (json) {
    const parsed = parseQmdJson(output)
    if (parsed.error) return null
    return parsed.results.length > 0
  }
  return !outputIndicatesNoResults(output)
}

const collectCommandOutput = (result: CommandResult) => {
  const parts = [result.error, result.stderr].filter((value): value is string =>
    Boolean(value),
  )
  if (parts.length === 0 && result.stdout) {
    parts.push(result.stdout)
  }
  return parts.join('\n')
}

const outputIndicatesMissingEmbeddings = (value: string) => {
  const normalized = value.toLowerCase()
  const patterns = [
    /no embedding(s)?/,
    /missing embedding(s)?/,
    /embedding(s)? (missing|not found)/,
    /embedding(s)? .* not found/,
    /vector.*(missing|not found)/,
    /model.*(missing|not found|failed to load|could not load)/,
    /gguf.*(missing|not found|failed to load|could not load)/,
    /tokenizer.*(missing|not found|failed to load|could not load)/,
  ]
  return patterns.some((pattern) => pattern.test(normalized))
}

const warnIfMissingEmbeddings = (
  mode: QmdMode,
  collection: string,
  result: CommandResult,
) => {
  if (mode === 'search') return false
  const output = collectCommandOutput(result)
  if (!output) return false
  if (!outputIndicatesMissingEmbeddings(output)) return false
  console.warn(
    `Warning: qmd ${mode} failed because embeddings/models appear missing for collection "${collection}". Run qmd embed for the collection (or provision the model) before retrying.`,
  )
  return true
}

const buildIndexCommands = (
  qmdPath: string,
  summaryDir: string,
  collection: string,
  mask: string,
  update: boolean,
): CommandSpec[] => {
  const commands: CommandSpec[] = [
    {
      label: 'collection-add',
      command: qmdPath,
      args: [
        'collection',
        'add',
        summaryDir,
        '--name',
        collection,
        '--mask',
        mask,
      ],
    },
  ]

  if (update) {
    commands.push({ label: 'update', command: qmdPath, args: ['update'] })
  }

  return commands
}

const buildSearchCommand = (
  qmdPath: string,
  mode: QmdMode,
  query: string,
  collection: string,
  limit: number,
  json: boolean,
  minScore: number | null,
  all: boolean,
): CommandSpec => {
  const args: string[] = [mode, query, '-c', collection, '-n', String(limit)]
  if (json) args.push('--json')
  if (all) args.push('--all')
  if (minScore !== null) args.push('--min-score', String(minScore))
  return { label: 'search', command: qmdPath, args }
}

const run = () => {
  if (getFlag('--help')) {
    console.log('opencode-recall-qmd-prototype')
    console.log('')
    console.log(
      'Usage: bun run scripts/opencode-recall-qmd-prototype.ts [options]',
    )
    console.log('')
    console.log('Options:')
    console.log('  --repo <path>        Repo root (default: cwd)')
    console.log(
      '  --summary-dir <path> Summary directory (default: <repo>/.continuum/recall/opencode)',
    )
    console.log('  --collection <name>  Override qmd collection name')
    console.log(
      '  --mask <glob>        File mask (default: OPENCODE-SUMMARY-*.md)',
    )
    console.log(
      '  --apply              Run qmd commands (otherwise print only)',
    )
    console.log('  --no-update          Skip qmd update step')
    console.log('  --qmd <path>          qmd binary (default: qmd)')
    console.log('  --search <query>     Run qmd search (BM25 by default)')
    console.log(
      '  --mode <mode>        search | query | vsearch (default: search)',
    )
    console.log('  --fallback-mode <m>  query | vsearch (default: vsearch)')
    console.log('  --no-fallback         Disable fallback for mode=search')
    console.log('  --min-score <n>      Minimum score filter (optional)')
    console.log(
      '  --all                Return all matches (use with --min-score)',
    )
    console.log(
      '  --mode=search        Falls back when no results (see fallback flags)',
    )
    console.log('  --limit <n>          Result limit (default: 5)')
    console.log('  --json               Output qmd search JSON')
    return
  }

  const repoPath = resolve(process.cwd(), getArgValue('--repo') ?? '.')
  const summaryDir = resolveSummaryDir(repoPath, getArgValue('--summary-dir'))
  const collection = buildCollectionName(repoPath, getArgValue('--collection'))
  const mask = getArgValue('--mask') ?? 'OPENCODE-SUMMARY-*.md'
  const apply = getFlag('--apply')
  const update = !getFlag('--no-update')
  const qmdPath = getArgValue('--qmd') ?? 'qmd'
  const query = getArgValue('--search')
  const modeRaw = getArgValue('--mode') ?? 'search'
  const mode = ['search', 'query', 'vsearch'].includes(modeRaw)
    ? (modeRaw as QmdMode)
    : 'search'
  const fallbackModeRaw = getArgValue('--fallback-mode')
  const fallbackMode: QmdMode =
    fallbackModeRaw === 'query' || fallbackModeRaw === 'vsearch'
      ? (fallbackModeRaw as QmdMode)
      : 'vsearch'
  const noFallback = getFlag('--no-fallback')
  const limitRaw = getArgValue('--limit')
  const limitCandidate = limitRaw ? Number(limitRaw) : Number.NaN
  const limit = Number.isFinite(limitCandidate) ? limitCandidate : 5
  const minScoreRaw = getArgValue('--min-score')
  const minScoreCandidate = minScoreRaw ? Number(minScoreRaw) : Number.NaN
  const minScore = Number.isFinite(minScoreCandidate) ? minScoreCandidate : null
  const all = getFlag('--all')
  const json = getFlag('--json')

  ensureSummaryDir(summaryDir, mask)

  const indexCommands = buildIndexCommands(
    qmdPath,
    summaryDir,
    collection,
    mask,
    update,
  )

  console.log(`Summary dir: ${summaryDir}`)
  console.log(`Collection: ${collection}`)

  if (!apply) {
    console.log('Run these to index:')
    for (const spec of indexCommands) {
      console.log(`- ${formatCommand(spec)}`)
    }
  } else {
    for (const spec of indexCommands) {
      const result = runCommand(spec, repoPath)
      if (!result.ok) {
        if (spec.label === 'collection-add') {
          console.log(
            'Note: collection add failed (already exists?). Continuing to update.',
          )
          continue
        }
        throw new Error(`qmd ${spec.label} failed with code ${result.code}`)
      }
    }
  }

  if (query) {
    const searchSpec = buildSearchCommand(
      qmdPath,
      mode,
      query,
      collection,
      limit,
      json,
      minScore,
      all,
    )
    if (!apply) {
      console.log('Search command:')
      console.log(`- ${formatCommand(searchSpec)}`)
      return
    }

    const result = runCommandWithOutput(searchSpec, repoPath)
    if (!result.ok) {
      warnIfMissingEmbeddings(mode, collection, result)
      throw new Error(`qmd ${mode} failed with code ${result.code}`)
    }

    const resultState = hasSearchResults(result.stdout, json)
    const allowFallback = mode === 'search' && !noFallback
    const shouldFallback = allowFallback && resultState === false
    const outputMode = shouldFallback ? fallbackMode : mode
    console.log(
      `Mode used: ${outputMode}${shouldFallback ? ' (fallback)' : ''}`,
    )
    if (shouldFallback) {
      const fallbackSpec = buildSearchCommand(
        qmdPath,
        fallbackMode,
        query,
        collection,
        limit,
        json,
        minScore,
        all,
      )
      const fallbackResult = runCommandWithOutput(fallbackSpec, repoPath)
      if (!fallbackResult.ok) {
        warnIfMissingEmbeddings(fallbackMode, collection, fallbackResult)
        throw new Error(
          `qmd ${fallbackMode} failed with code ${fallbackResult.code}`,
        )
      }
      if (fallbackResult.stderr) process.stderr.write(fallbackResult.stderr)
      if (fallbackResult.stdout) process.stdout.write(fallbackResult.stdout)
      return
    }

    if (result.stderr) process.stderr.write(result.stderr)
    if (result.stdout) process.stdout.write(result.stdout)
  }
}

run()
