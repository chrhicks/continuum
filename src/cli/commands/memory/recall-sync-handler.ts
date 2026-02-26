import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildOpencodeSyncLedger,
  runOpencodeSyncPlan,
  updateOpencodeSyncLedger,
  type OpencodeSyncLedger,
} from '../../../recall/sync/opencode-sync'
import {
  appendJsonLine,
  parseProcessedVersion,
  parseSyncLimit,
  resolveRecallPath,
  writeJsonFile,
} from './recall-helpers'
import { resolveRecallDataRoot } from '../../../recall/index/opencode-source-index'
import type { RecallSyncOptions } from './recall-subcommands'

function writeRecallSyncLedger(
  ledgerPath: string,
  result: ReturnType<typeof runOpencodeSyncPlan>,
  processedVersion: number,
  now: string,
): boolean {
  const shouldWriteLedger = !result.dryRun && result.results.length > 0
  if (!shouldWriteLedger) {
    return false
  }

  const existingLedger = existsSync(ledgerPath)
    ? (JSON.parse(readFileSync(ledgerPath, 'utf-8')) as OpencodeSyncLedger)
    : null
  const baseLedger =
    existingLedger ??
    buildOpencodeSyncLedger(result.plan, processedVersion, now)
  const nextLedger: OpencodeSyncLedger = {
    ...baseLedger,
    processed_version: processedVersion,
  }
  const updatedLedger = updateOpencodeSyncLedger(
    nextLedger,
    result.results,
    now,
  )
  writeJsonFile(ledgerPath, updatedLedger)
  return true
}

function printRecallSyncResult(
  options: RecallSyncOptions,
  result: ReturnType<typeof runOpencodeSyncPlan>,
  ledgerPath: string,
  logPath: string,
): void {
  if (result.commandAppended) {
    console.log('Note: appended --project {project_id} to command template.')
  }
  if (result.warning) {
    console.log(`Warning: ${result.warning}`)
  }

  if (options.verbose) {
    for (const entry of result.results) {
      const label = entry.status.toUpperCase()
      const commandLabel = entry.command ? ` command=${entry.command}` : ''
      console.log(`${label}: ${entry.item.key}${commandLabel}`)
    }
  }

  console.log(`Plan file: ${result.planPath}`)
  if (!result.dryRun && result.results.length > 0) {
    console.log(`Ledger file: ${ledgerPath}`)
  }
  console.log(`Sync log: ${logPath}`)
  if (result.dryRun && !result.commandTemplate) {
    console.log('Dry-run: missing --command, no execution performed.')
  }
  console.log(`Items processed: ${result.results.length}`)
  console.log(`- success: ${result.summary.success}`)
  console.log(`- failed: ${result.summary.failed}`)
  console.log(`- skipped: ${result.summary.skipped}`)
}

export function handleRecallSync(options: RecallSyncOptions): void {
  const dataRoot = resolveRecallDataRoot(options.dataRoot)
  const ledgerPath = resolveRecallPath(
    dataRoot,
    options.ledger ?? null,
    'state.json',
  )
  const logPath = resolveRecallPath(
    dataRoot,
    options.log ?? null,
    'sync-log.jsonl',
  )
  const limit = parseSyncLimit(options.limit)
  const processedVersion = parseProcessedVersion(options.processedVersion)
  const result = runOpencodeSyncPlan({
    planPath: options.plan ?? null,
    dataRoot,
    commandTemplate: options.command ?? null,
    cwd: options.cwd ?? null,
    dryRun: options.dryRun,
    failFast: options.failFast,
    limit,
  })

  const now = new Date().toISOString()
  const ledgerWritten = writeRecallSyncLedger(
    ledgerPath,
    result,
    processedVersion,
    now,
  )
  const runCwd = resolve(process.cwd(), options.cwd ?? '.')
  appendJsonLine(logPath, {
    generated_at: now,
    plan_path: result.planPath,
    ledger_path: ledgerPath,
    command_template: result.commandTemplate,
    command_appended: result.commandAppended,
    warning: result.warning,
    dry_run: result.dryRun,
    fail_fast: Boolean(options.failFast),
    limit,
    cwd: runCwd,
    processed_version: processedVersion,
    items_processed: result.results.length,
    summary: result.summary,
    results: result.results,
    ledger_written: ledgerWritten,
  })

  printRecallSyncResult(options, result, ledgerPath, logPath)
}
