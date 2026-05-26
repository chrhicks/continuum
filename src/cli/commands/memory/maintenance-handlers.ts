import { readConsolidationLog } from '../../../memory/log'
import { repairRecent } from '../../../memory/repair-recent'
import { recoverStaleNowFiles } from '../../../memory/recover'
import { validateMemory } from '../../../memory/validate'

export function handleValidate(): void {
  const result = validateMemory()
  if (result.filesChecked === 0) {
    console.log('No memory files found.')
    return
  }
  if (result.errors.length === 0) {
    console.log(
      `Memory validation passed (${result.filesChecked} files checked).`,
    )
    return
  }

  console.error(
    `Memory validation failed with ${result.errors.length} issue(s):`,
  )
  for (const error of result.errors) {
    console.error(`- ${error.filePath}:${error.lineNumber} ${error.message}`)
  }
  process.exitCode = 1
}

export function handleLog(tail?: number): void {
  const result = readConsolidationLog({ tail })
  if (result.totalLines === 0) {
    console.log('No consolidation log entries found.')
    return
  }

  const tailLabel = result.truncated
    ? ` (showing last ${result.lines.length} of ${result.totalLines} lines)`
    : ''
  console.log(`Consolidation log${tailLabel}:`)
  console.log(`- Path: ${result.filePath}`)
  console.log(result.lines.join('\n'))
}

export async function handleRecover(
  maxHours: number | undefined,
  consolidate: boolean,
): Promise<void> {
  const result = await recoverStaleNowFiles({ maxHours, consolidate })
  if (result.totalNowFiles === 0) {
    console.log('No NOW files found.')
    return
  }
  if (result.staleNowFiles.length === 0) {
    console.log(
      `No stale NOW files found (threshold: ${result.thresholdHours}h).`,
    )
    return
  }

  console.log(`Stale NOW files (>${result.thresholdHours}h):`)
  for (const stale of result.staleNowFiles) {
    const hours = Math.round(stale.ageHours * 10) / 10
    console.log(`- ${stale.filePath} (${hours}h old)`)
  }

  if (consolidate) {
    console.log(`Recovered ${result.recovered.length} session(s).`)
  } else {
    console.log('Run with --consolidate to recover these sessions.')
  }
}

export function handleRepairRecent(dryRun: boolean): void {
  const result = repairRecent({ dryRun })
  if (result.rebuiltEntries === 0) {
    console.log('No consolidated memory sections found to rebuild RECENT.')
    return
  }

  if (dryRun) {
    console.log('RECENT rebuild dry run (no files written):')
  } else {
    console.log('RECENT rebuilt from memory files:')
  }
  console.log(`- Path: ${result.recentPath}`)
  console.log(`- Entries: ${result.rebuiltEntries}`)
  console.log(`- Meaningful entries: ${result.meaningfulEntries}`)
  console.log(`- Reused durations: ${result.reusedDurations}`)
  console.log(`- Unknown durations: ${result.unknownDurations}`)
  console.log(`- Lines: ${result.recentLines}`)
}
