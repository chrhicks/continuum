import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type { OpencodeSyncPlan } from '../diff/opencode-diff'
import { resolveRecallDataRoot } from '../index/opencode-source-index'
import {
  adjustTemplateForScope,
  limitSyncPlanItems,
  processSyncPlanItem,
  summarizeSyncRunResults,
  type OpencodeSyncProcessResult,
  type OpencodeSyncRunSummary,
} from './opencode-sync-runner'
import {
  buildOpencodeSyncLedger,
  updateOpencodeSyncLedger,
  type OpencodeSyncLedger,
  type OpencodeSyncLedgerEntry,
  type OpencodeSyncLedgerEntryStatus,
} from './opencode-sync-ledger'

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

export type {
  OpencodeSyncProcessResult,
  OpencodeSyncRunSummary,
  OpencodeSyncLedgerEntryStatus,
  OpencodeSyncLedgerEntry,
  OpencodeSyncLedger,
}

export { buildOpencodeSyncLedger, updateOpencodeSyncLedger }

export function resolveOpencodeSyncPlanFile(
  dataRoot: string,
  value?: string | null,
): string {
  if (value) return resolvePath(value)
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
  const items = limitSyncPlanItems(
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
    const result = processSyncPlanItem(item, {
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
    summary: summarizeSyncRunResults(results),
  }
}

const resolvePath = (value: string, base?: string): string => {
  if (isAbsolute(value)) return value
  return resolve(base ?? process.cwd(), value)
}
