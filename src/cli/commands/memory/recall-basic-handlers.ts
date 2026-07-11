import { importCanonicalOpencodeRecall } from '../../../memory/application/recall-import'
import { parseRecallLimit } from './option-parsers'
import type { RecallImportOptions } from './recall-subcommands'
import type { Command } from 'commander'
import { Effect } from 'effect'
import { runMemoryCommand } from '../../io'
import { MemoryRuntime } from '../../../memory/runtime/memory-runtime'
import { makeRecallRepository } from '../../../memory/repository/recall-repository'

export async function handleRecallStatus(command: Command): Promise<void> {
  await runMemoryCommand(
    command,
    Effect.gen(function* () {
      const runtime = yield* MemoryRuntime
      return runtime.handle.sqlite
        .query(
          `SELECT
       (SELECT COUNT(*) FROM memory_recall_sources) sources,
       (SELECT COUNT(*) FROM memory_recall_messages) messages,
       (SELECT COUNT(*) FROM memory_recall_summaries) summaries`,
        )
        .get() as { sources: number; messages: number; summaries: number }
    }),
    (counts) => {
      console.log('Canonical recall status:')
      console.log(`- Sources: ${counts.sources}`)
      console.log(`- Raw messages: ${counts.messages}`)
      console.log(`- Derived summaries: ${counts.summaries}`)
    },
  )
}

export async function handleRecallImport(
  options: RecallImportOptions,
  command: Command,
): Promise<void> {
  await runMemoryCommand(
    command,
    Effect.gen(function* () {
      const runtime = yield* MemoryRuntime
      return yield* importCanonicalOpencodeRecall({
        continuumDbPath: runtime.dbPath,
        dbPath: options.db,
        repoPath: runtime.workspaceRoot,
        projectId: options.project,
        sessionId: options.session,
        afterDate: options.after ? parseDate(options.after) : undefined,
        limit: options.limit ? parseRecallLimit(options.limit) : undefined,
        dryRun: options.dryRun,
        repository: makeRecallRepository(runtime.handle),
      })
    }),
    (result) => {
      console.log(`Recall import${result.dryRun ? ' dry run' : ''}:`)
      console.log(`- Sessions inspected: ${result.totalSessions}`)
      console.log(`- Imported: ${result.imported}`)
      console.log(`- Refreshed: ${result.changed}`)
      console.log(`- Current: ${result.skippedExisting}`)
    },
  )
}

function parseDate(value: string): Date {
  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    throw new Error(`Invalid recall date: ${value}`)
  return date
}
