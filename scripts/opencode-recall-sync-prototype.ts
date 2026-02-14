import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

type SyncPlanItem = {
  key: string
  session_id: string
  project_id: string
  title: string | null
  status: 'new' | 'stale'
  reason: string | null
  source_fingerprint: string | null
  source_updated_at: string | null
  summary_fingerprint: string | null
  summary_generated_at: string | null
  summary_path: string | null
}

type SyncPlan = {
  version: number
  generated_at: string
  index_file: string
  summary_dir: string
  report_file: string | null
  stats: {
    total: number
    new: number
    stale: number
  }
  items: SyncPlanItem[]
}

type LedgerEntryStatus = 'processed' | 'pending' | 'orphan' | 'unknown'

type LedgerEntry = {
  key: string
  session_id: string | null
  project_id: string | null
  status: LedgerEntryStatus
  reason: string | null
  source_fingerprint: string | null
  source_updated_at: string | null
  summary_fingerprint: string | null
  summary_path: string | null
  summary_generated_at: string | null
  processed_at: string | null
  verified_at: string
}

type Ledger = {
  version: number
  processed_version: number
  generated_at: string
  index_file: string
  summary_dir: string
  entries: Record<string, LedgerEntry>
  stats: {
    processed: number
    pending: number
    orphan: number
    unknown: number
  }
}

type CommandResult = {
  ok: boolean
  code: number | null
  error: string | null
}

type ProcessResult = {
  item: SyncPlanItem
  status: 'success' | 'failed' | 'skipped'
  command: string | null
  error: string | null
}

const LEDGER_PROCESSED_VERSION_DEFAULT = 1

const args = process.argv.slice(2)
const getFlag = (name: string) => args.includes(name)
const getArgValue = (name: string) => {
  const direct = args.find((arg) => arg.startsWith(`${name}=`))
  if (direct) return direct.split('=').slice(1).join('=')
  const index = args.findIndex((arg) => arg === name)
  if (index !== -1 && args[index + 1]) return args[index + 1]
  return null
}

const resolvePath = (value: string | null, base?: string): string | null => {
  if (!value) return null
  if (isAbsolute(value)) return value
  return resolve(base ?? process.cwd(), value)
}

const resolveDataRoot = (value: string | null): string => {
  if (value) return resolvePath(value) as string
  const dataHome = process.env.XDG_DATA_HOME
  return join(dataHome ?? join(homedir(), '.local', 'share'), 'continuum')
}

const resolvePlanFile = (value: string | null, dataRoot: string): string => {
  if (value) return resolvePath(value) as string
  return join(dataRoot, 'recall', 'opencode', 'sync-plan.json')
}

const resolveLedgerFile = (value: string | null, dataRoot: string): string => {
  if (value) return resolvePath(value) as string
  return join(dataRoot, 'recall', 'opencode', 'state.json')
}

const writeJsonFile = (filePath: string, payload: unknown) => {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
}

const applyTemplate = (template: string, item: SyncPlanItem): string => {
  return template
    .split('{session_id}')
    .join(item.session_id)
    .split('{project_id}')
    .join(item.project_id)
    .split('{key}')
    .join(item.key)
}

const runCommand = (command: string, cwd: string): CommandResult => {
  try {
    const result = spawnSync(command, {
      shell: true,
      stdio: 'inherit',
      cwd,
    })
    const ok = result.status === 0
    return {
      ok,
      code: result.status ?? null,
      error: result.error ? String(result.error.message ?? result.error) : null,
    }
  } catch (error) {
    return {
      ok: false,
      code: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

const processItem = (
  item: SyncPlanItem,
  options: { commandTemplate: string | null; cwd: string; dryRun: boolean },
): ProcessResult => {
  if (!options.commandTemplate) {
    return {
      item,
      status: 'skipped',
      command: null,
      error: 'missing-command-template',
    }
  }

  const command = applyTemplate(options.commandTemplate, item)
  if (options.dryRun) {
    return {
      item,
      status: 'skipped',
      command,
      error: 'dry-run',
    }
  }

  const result = runCommand(command, options.cwd)
  return {
    item,
    status: result.ok ? 'success' : 'failed',
    command,
    error: result.error,
  }
}

const buildBaseLedger = (
  plan: SyncPlan,
  processedVersion: number,
  now: string,
): Ledger => {
  return {
    version: 1,
    processed_version: processedVersion,
    generated_at: now,
    index_file: plan.index_file,
    summary_dir: plan.summary_dir,
    entries: {},
    stats: {
      processed: 0,
      pending: 0,
      orphan: 0,
      unknown: 0,
    },
  }
}

const computeLedgerStats = (entries: Record<string, LedgerEntry>) => {
  return Object.values(entries).reduce(
    (acc, entry) => ({
      ...acc,
      [entry.status]: acc[entry.status] + 1,
    }),
    {
      processed: 0,
      pending: 0,
      orphan: 0,
      unknown: 0,
    },
  )
}

const buildProcessedEntry = (
  existing: LedgerEntry | null,
  item: SyncPlanItem,
  now: string,
): LedgerEntry => {
  return {
    key: item.key,
    session_id: item.session_id,
    project_id: item.project_id,
    status: 'processed',
    reason: 'processed',
    source_fingerprint:
      item.source_fingerprint ?? existing?.source_fingerprint ?? null,
    source_updated_at:
      item.source_updated_at ?? existing?.source_updated_at ?? null,
    summary_fingerprint:
      item.summary_fingerprint ?? existing?.summary_fingerprint ?? null,
    summary_path: item.summary_path ?? existing?.summary_path ?? null,
    summary_generated_at:
      item.summary_generated_at ?? existing?.summary_generated_at ?? null,
    processed_at: now,
    verified_at: now,
  }
}

const updateLedger = (
  ledger: Ledger,
  results: ProcessResult[],
  now: string,
): Ledger => {
  const updates = results
    .filter((result) => result.status === 'success')
    .map((result) => ({
      key: result.item.key,
      entry: buildProcessedEntry(
        ledger.entries[result.item.key] ?? null,
        result.item,
        now,
      ),
    }))

  const updatedEntries = updates.reduce<Record<string, LedgerEntry>>(
    (acc, update) => ({
      ...acc,
      [update.key]: update.entry,
    }),
    ledger.entries,
  )

  return {
    ...ledger,
    generated_at: now,
    entries: updatedEntries,
    stats: computeLedgerStats(updatedEntries),
  }
}

const limitItems = (items: SyncPlanItem[], limit: number | null) => {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return items
  return items.slice(0, limit)
}

const summarizeResults = (results: ProcessResult[]) => {
  return results.reduce(
    (acc, result) => ({
      ...acc,
      [result.status]: acc[result.status] + 1,
    }),
    { success: 0, failed: 0, skipped: 0 },
  )
}

const run = () => {
  if (getFlag('--help')) {
    console.log('opencode-recall-sync-prototype')
    console.log('')
    console.log(
      'Usage: bun run scripts/opencode-recall-sync-prototype.ts [options]',
    )
    console.log('')
    console.log('Options:')
    console.log(
      '  --plan <path>          Sync plan file (default: <data-root>/recall/opencode/sync-plan.json)',
    )
    console.log(
      '  --ledger <path>        Ledger file (default: <data-root>/recall/opencode/state.json)',
    )
    console.log(
      '  --data-root <path>     Continuum data root (default: $XDG_DATA_HOME/continuum)',
    )
    console.log(
      '  --command <template>   Command template (supports {session_id}, {project_id}, {key})',
    )
    console.log(
      '  --cwd <path>           Working directory for commands (default: cwd)',
    )
    console.log('  --dry-run              Skip execution and ledger updates')
    console.log('  --fail-fast            Stop on first failure')
    console.log('  --limit <n>            Limit number of items processed')
    console.log('  --no-ledger            Skip writing ledger updates')
    console.log(
      `  --processed-version <n> Ledger processed version (default: ${LEDGER_PROCESSED_VERSION_DEFAULT})`,
    )
    console.log('  --verbose              Print per-item results')
    return
  }

  const dataRoot = resolveDataRoot(getArgValue('--data-root'))
  const planPath = resolvePlanFile(getArgValue('--plan'), dataRoot)
  const ledgerPath = resolveLedgerFile(getArgValue('--ledger'), dataRoot)
  const commandTemplate = getArgValue('--command')
  const cwd = resolve(process.cwd(), getArgValue('--cwd') ?? '.')
  const dryRun = getFlag('--dry-run') || !commandTemplate
  const failFast = getFlag('--fail-fast')
  const verbose = getFlag('--verbose')
  const limitRaw = getArgValue('--limit')
  const limit = limitRaw ? Number(limitRaw) : null
  const writeLedger = !getFlag('--no-ledger') && !dryRun
  const processedVersionRaw = getArgValue('--processed-version')
  const processedVersionCandidate = processedVersionRaw
    ? Number(processedVersionRaw)
    : Number.NaN
  const processedVersion = Number.isFinite(processedVersionCandidate)
    ? processedVersionCandidate
    : LEDGER_PROCESSED_VERSION_DEFAULT

  if (!existsSync(planPath)) {
    throw new Error(`Sync plan not found: ${planPath}`)
  }

  const plan = JSON.parse(readFileSync(planPath, 'utf-8')) as SyncPlan
  const items = limitItems(plan.items ?? [], limit)

  const existingLedger = existsSync(ledgerPath)
    ? (JSON.parse(readFileSync(ledgerPath, 'utf-8')) as Ledger)
    : null
  const now = new Date().toISOString()
  const baseLedger =
    existingLedger ?? buildBaseLedger(plan, processedVersion, now)
  const ledger = {
    ...baseLedger,
    processed_version: processedVersion,
  }

  const results: ProcessResult[] = []
  for (const item of items) {
    const result = processItem(item, { commandTemplate, cwd, dryRun })
    results.push(result)
    if (verbose) {
      const label = result.status.toUpperCase()
      const commandLabel = result.command ? ` command=${result.command}` : ''
      console.log(`${label}: ${result.item.key}${commandLabel}`)
    }
    if (result.status === 'failed' && failFast) {
      break
    }
  }

  const summary = summarizeResults(results)
  const updatedLedger = writeLedger
    ? updateLedger(ledger, results, now)
    : ledger

  if (writeLedger) {
    writeJsonFile(ledgerPath, updatedLedger)
  }

  console.log(`Plan file: ${planPath}`)
  if (writeLedger) {
    console.log(`Ledger file: ${ledgerPath}`)
  }
  if (dryRun && !commandTemplate) {
    console.log('Dry-run: missing --command, no execution performed.')
  }
  console.log(`Items processed: ${items.length}`)
  console.log(`- success: ${summary.success}`)
  console.log(`- failed: ${summary.failed}`)
  console.log(`- skipped: ${summary.skipped}`)
}

run()
