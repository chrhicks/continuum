import { importOpencodeRecall } from '../../../memory/recall-import'
import { searchRecall } from '../../../recall/search'
import { buildOpencodeSourceIndex } from '../../../recall/index/opencode-source-index'
import {
  formatRecallModeLabel,
  formatScore,
  parseRecallLimit,
  parseRecallMode,
  writeJsonFile,
} from './recall-helpers'
import type {
  RecallImportOptions,
  RecallIndexOptions,
  RecallSearchOptions,
} from './recall-subcommands'

export async function handleRecallImport(
  options: RecallImportOptions,
): Promise<void> {
  const result = await importOpencodeRecall({
    summaryDir: options.summaryDir,
    outDir: options.out,
    dbPath: options.db,
    projectId: options.project,
    sessionId: options.session,
    dryRun: options.dryRun,
  })

  if (result.totalSummaries === 0) {
    console.log(`No opencode recall summaries found in ${result.summaryDir}.`)
    return
  }

  const dryRunLabel = result.dryRun ? ' (dry run)' : ''
  console.log(`Recall import${dryRunLabel}:`)
  console.log(`- Summary dir: ${result.summaryDir}`)
  console.log(`- Summaries: ${result.totalSummaries}`)
  console.log(`- Imported: ${result.imported}`)
  console.log(`- Skipped (existing): ${result.skippedExisting}`)
  console.log(`- Skipped (invalid): ${result.skippedInvalid}`)
  if (result.skippedFiltered > 0) {
    console.log(`- Skipped (filtered): ${result.skippedFiltered}`)
  }

  if (result.importedSessions.length > 0) {
    console.log(`- Sessions: ${result.importedSessions.join(', ')}`)
  }

  if (result.skipped.length > 0) {
    console.log('Skipped summaries:')
    for (const entry of result.skipped) {
      const label = entry.sessionId ? ` (${entry.sessionId})` : ''
      console.log(`- ${entry.summaryPath}${label}: ${entry.reason}`)
    }
  }
}

export function handleRecallIndex(options: RecallIndexOptions): void {
  const index = buildOpencodeSourceIndex({
    dbPath: options.db,
    dataRoot: options.dataRoot,
    indexFile: options.index,
    projectId: options.project,
    sessionId: options.session,
  })

  if (options.verbose) {
    for (const entry of Object.values(index.sessions)) {
      console.log(`Indexed ${entry.key} (${entry.message_count} messages)`)
    }
  }

  writeJsonFile(index.index_file, index)
  console.log(`Source index written: ${index.index_file}`)
  console.log(
    `Sessions indexed: ${index.stats.session_count} (projects: ${index.stats.project_count})`,
  )
}

export function handleRecallSearch(
  query: string,
  options: RecallSearchOptions,
): void {
  const mode = parseRecallMode(options.mode)
  const limit = parseRecallLimit(options.limit)
  const result = searchRecall({
    query,
    mode,
    summaryDir: options.summaryDir,
    limit,
  })

  if (result.filesSearched === 0) {
    console.log(`No opencode recall summaries found in ${result.summaryDir}.`)
    return
  }

  const modeLabel = formatRecallModeLabel(result.mode)
  const modeOutput = result.fallback ? `${modeLabel} (fallback)` : modeLabel

  console.log('Recall search:')
  console.log(`- Mode: ${modeOutput}`)
  console.log(`- Summary dir: ${result.summaryDir}`)
  console.log(`- Files searched: ${result.filesSearched}`)
  console.log(`- Results: ${result.results.length}`)

  if (result.results.length === 0) {
    console.log(`No matches found for "${query}".`)
    return
  }

  for (const match of result.results) {
    const score = formatScore(match.score)
    const sessionLabel = match.sessionId ? ` [${match.sessionId}]` : ''
    const titleLabel = match.title ? ` (${match.title})` : ''
    const snippetLabel = match.snippet ? ` - ${match.snippet}` : ''
    console.log(
      `- [${score}] ${match.filePath}${sessionLabel}${titleLabel}${snippetLabel}`,
    )
  }
}
