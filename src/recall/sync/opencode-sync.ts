import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type {
  OpencodeSyncPlan,
  OpencodeSyncPlanItem,
} from '../diff/opencode-diff'
import { resolveRecallDataRoot } from '../index/opencode-source-index'

const DEFAULT_SYNC_PLAN_FILE = join('recall', 'opencode', 'sync-plan.json')

export type OpencodeSyncRunOptions = {
  planPath?: string | null
  dataRoot?: string | null
  commandTemplate?: string | null
  cwd?: string | null
  dryRun?: boolean
  failFast?: boolean
  limit?: number | null
}

export type OpencodeSyncProcessResult = {
  item: OpencodeSyncPlanItem
  status: 'success' | 'failed' | 'skipped'
  command: string | null
  error: string | null
}

export type OpencodeSyncRunSummary = {
  success: number
  failed: number
  skipped: number
}

export type OpencodeSyncRunResult = {
  plan: OpencodeSyncPlan
  planPath: string
  commandTemplate: string | null
  commandAppended: boolean
  warning: string | null
  dryRun: boolean
  results: OpencodeSyncProcessResult[]
  summary: OpencodeSyncRunSummary
}

export type OpencodeSyncLedgerEntryStatus =
  | 'processed'
  | 'pending'
  | 'orphan'
  | 'unknown'

export type OpencodeSyncLedgerEntry = {
  key: string
  session_id: string | null
  project_id: string | null
  status: OpencodeSyncLedgerEntryStatus
  reason: string | null
  source_fingerprint: string | null
  source_updated_at: string | null
  summary_fingerprint: string | null
  summary_path: string | null
  summary_generated_at: string | null
  processed_at: string | null
  verified_at: string
}

export type OpencodeSyncLedger = {
  version: number
  processed_version: number
  generated_at: string
  index_file: string
  summary_dir: string
  entries: Record<string, OpencodeSyncLedgerEntry>
  stats: {
    processed: number
    pending: number
    orphan: number
    unknown: number
  }
}

export function resolveOpencodeSyncPlanFile(
  dataRoot: string,
  value?: string | null,
): string {
  if (value) return resolvePath(value) as string
  return join(dataRoot, DEFAULT_SYNC_PLAN_FILE)
}

export function runOpencodeSyncPlan(
  options: OpencodeSyncRunOptions = {},
): OpencodeSyncRunResult {
  const dataRoot = resolveRecallDataRoot(options.dataRoot ?? null)
  const planPath = resolveOpencodeSyncPlanFile(
    dataRoot,
    options.planPath ?? null,
  )

  if (!existsSync(planPath)) {
    throw new Error(`Sync plan not found: ${planPath}`)
  }

  const plan = JSON.parse(readFileSync(planPath, 'utf-8')) as OpencodeSyncPlan
  const items = limitItems(
    Array.isArray(plan.items) ? plan.items : [],
    options.limit ?? null,
  )
  const adjustedTemplate = adjustTemplateForScope(
    options.commandTemplate ?? null,
    plan,
  )
  const commandTemplate = adjustedTemplate.template
  const dryRun = Boolean(options.dryRun) || !commandTemplate
  const cwd = resolve(process.cwd(), options.cwd ?? '.')

  const results: OpencodeSyncProcessResult[] = []
  for (const item of items) {
    const result = processItem(item, {
      commandTemplate,
      cwd,
      dryRun,
    })
    results.push(result)
    if (result.status === 'failed' && options.failFast) {
      break
    }
  }

  return {
    plan,
    planPath,
    commandTemplate,
    commandAppended: adjustedTemplate.appended,
    warning: adjustedTemplate.warning,
    dryRun,
    results,
    summary: summarizeResults(results),
  }
}

export function buildOpencodeSyncLedger(
  plan: OpencodeSyncPlan,
  processedVersion: number,
  now: string,
): OpencodeSyncLedger {
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

export function updateOpencodeSyncLedger(
  ledger: OpencodeSyncLedger,
  results: OpencodeSyncProcessResult[],
  now: string,
): OpencodeSyncLedger {
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

  if (updates.length === 0) {
    return ledger
  }

  const updatedEntries = updates.reduce<
    Record<string, OpencodeSyncLedgerEntry>
  >(
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

type CommandResult = {
  ok: boolean
  code: number | null
  error: string | null
}

const projectFlagPattern = /--project(?:-id)?(?=\s|=|$)/

const resolvePath = (value: string, base?: string): string => {
  if (isAbsolute(value)) return value
  return resolve(base ?? process.cwd(), value)
}

const adjustTemplateForScope = (
  template: string | null,
  plan: OpencodeSyncPlan,
): { template: string | null; appended: boolean; warning: string | null } => {
  if (!template) {
    return { template, appended: false, warning: null }
  }
  if (!plan.project_scope?.include_global) {
    return { template, appended: false, warning: null }
  }

  const hasProjectPlaceholder = template.includes('{project_id}')
  const hasProjectFlag = projectFlagPattern.test(template)

  if (hasProjectPlaceholder) {
    return { template, appended: false, warning: null }
  }

  if (hasProjectFlag) {
    return {
      template,
      appended: false,
      warning:
        'Plan includes global sessions but command template does not reference {project_id}.',
    }
  }

  return {
    template: `${template} --project {project_id}`,
    appended: true,
    warning: null,
  }
}

const applyTemplate = (
  template: string,
  item: OpencodeSyncPlanItem,
): string => {
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
  item: OpencodeSyncPlanItem,
  options: {
    commandTemplate: string | null
    cwd: string
    dryRun: boolean
  },
): OpencodeSyncProcessResult => {
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

const limitItems = (
  items: OpencodeSyncPlanItem[],
  limit: number | null,
): OpencodeSyncPlanItem[] => {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return items
  return items.slice(0, limit)
}

const buildProcessedEntry = (
  existing: OpencodeSyncLedgerEntry | null,
  item: OpencodeSyncPlanItem,
  now: string,
): OpencodeSyncLedgerEntry => {
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

const computeLedgerStats = (
  entries: Record<string, OpencodeSyncLedgerEntry>,
): OpencodeSyncLedger['stats'] => {
  return Object.values(entries).reduce<OpencodeSyncLedger['stats']>(
    (acc, entry) => ({
      ...acc,
      [entry.status]: acc[entry.status] + 1,
    }),
    { processed: 0, pending: 0, orphan: 0, unknown: 0 },
  )
}

const summarizeResults = (
  results: OpencodeSyncProcessResult[],
): OpencodeSyncRunSummary => {
  return results.reduce<OpencodeSyncRunSummary>(
    (acc, result) => ({
      ...acc,
      [result.status]: acc[result.status] + 1,
    }),
    { success: 0, failed: 0, skipped: 0 },
  )
}
