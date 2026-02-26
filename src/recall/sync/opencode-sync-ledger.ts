import type {
  OpencodeSyncPlan,
  OpencodeSyncPlanItem,
} from '../diff/opencode-diff'
import type { OpencodeSyncProcessResult } from './opencode-sync-runner'

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
  if (results.length === 0) {
    return ledger
  }

  const updates = results
    .map((result) => {
      const existing = ledger.entries[result.item.key] ?? null
      if (result.status === 'success') {
        return {
          key: result.item.key,
          entry: buildProcessedEntry(existing, result.item, now),
        }
      }
      if (result.status === 'failed' || result.status === 'skipped') {
        return {
          key: result.item.key,
          entry: buildPendingEntry(
            existing,
            result.item,
            now,
            buildLedgerReason(result),
          ),
        }
      }
      return null
    })
    .filter(
      (update): update is { key: string; entry: OpencodeSyncLedgerEntry } =>
        Boolean(update),
    )

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

function buildProcessedEntry(
  existing: OpencodeSyncLedgerEntry | null,
  item: OpencodeSyncPlanItem,
  now: string,
): OpencodeSyncLedgerEntry {
  return {
    ...buildLedgerEntryBase(existing, item),
    status: 'processed',
    reason: 'processed',
    processed_at: now,
    verified_at: now,
  }
}

function buildPendingEntry(
  existing: OpencodeSyncLedgerEntry | null,
  item: OpencodeSyncPlanItem,
  now: string,
  reason: string,
): OpencodeSyncLedgerEntry {
  return {
    ...buildLedgerEntryBase(existing, item),
    status: 'pending',
    reason,
    processed_at: existing?.processed_at ?? null,
    verified_at: now,
  }
}

function buildLedgerEntryBase(
  existing: OpencodeSyncLedgerEntry | null,
  item: OpencodeSyncPlanItem,
): Omit<
  OpencodeSyncLedgerEntry,
  'status' | 'reason' | 'processed_at' | 'verified_at'
> {
  return {
    key: item.key,
    session_id: item.session_id,
    project_id: item.project_id,
    source_fingerprint:
      item.source_fingerprint ?? existing?.source_fingerprint ?? null,
    source_updated_at:
      item.source_updated_at ?? existing?.source_updated_at ?? null,
    summary_fingerprint:
      item.summary_fingerprint ?? existing?.summary_fingerprint ?? null,
    summary_path: item.summary_path ?? existing?.summary_path ?? null,
    summary_generated_at:
      item.summary_generated_at ?? existing?.summary_generated_at ?? null,
  }
}

function computeLedgerStats(
  entries: Record<string, OpencodeSyncLedgerEntry>,
): OpencodeSyncLedger['stats'] {
  return Object.values(entries).reduce<OpencodeSyncLedger['stats']>(
    (acc, entry) => ({
      ...acc,
      [entry.status]: acc[entry.status] + 1,
    }),
    { processed: 0, pending: 0, orphan: 0, unknown: 0 },
  )
}

function buildLedgerReason(result: OpencodeSyncProcessResult): string {
  const base = result.status === 'failed' ? 'failed' : 'skipped'
  const detail = normalizeLedgerReason(result.error)
  return detail ? `${base}: ${detail}` : base
}

function normalizeLedgerReason(value: string | null): string | null {
  if (!value) return null
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : null
}
