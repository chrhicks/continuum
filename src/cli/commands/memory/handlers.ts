import { join } from 'node:path'
import { appendMemory } from '../../../memory/application/append'
import { consolidateMemory } from '../../../memory/application/consolidate'
import { migrateLegacyMemory } from '../../../memory/application/legacy-migrate'
import { getWorkspaceContext } from '../../../memory/paths'
import {
  parseAfterDate,
  parseSearchLimit,
  parseSearchSource,
  parseSearchTags,
  parseSearchTier,
} from './option-parsers'
import { registerMemorySubcommands } from './memory-subcommands'
import { handleSearch } from './search-handler'
import type { Command } from 'commander'
import { Effect } from 'effect'
import { runCommand, runMemoryCommand } from '../../io'
import { MemoryRuntime } from '../../../memory/runtime/memory-runtime'
import { makeJournalRepository } from '../../../memory/repository/journal-repository'
import { makeConsolidationRepository } from '../../../memory/repository/consolidation-repository'

export function registerMemoryHandlers(memory: Command): void {
  registerMemorySubcommands(memory, {
    onAppend: handleAppend,
    onConsolidate: handleConsolidate,
    onMigrate: handleMigrate,
    onSearch: (query, options, command) =>
      handleSearch(
        {
          query,
          tier: options.tier ? parseSearchTier(options.tier) : 'all',
          source: options.source ? parseSearchSource(options.source) : 'all',
          tags: options.tags ? parseSearchTags(options.tags) : [],
          afterDate: options.after ? parseAfterDate(options.after) : undefined,
          limit: options.limit ? parseSearchLimit(options.limit) : undefined,
        },
        command,
      ),
  })
}

async function handleMigrate(dryRun: boolean, command: Command): Promise<void> {
  if (dryRun) {
    const context = getWorkspaceContext()
    await runCommand(
      command,
      async () =>
        migrateLegacyMemory({
          workspaceRoot: context.workspaceRoot,
          memoryDir: context.memoryDir,
          dbPath: context.continuumDbPath,
          dryRun: true,
        }),
      renderMigration,
    )
    return
  }
  await runMemoryCommand(
    command,
    Effect.gen(function* () {
      const runtime = yield* MemoryRuntime
      return yield* Effect.try(() =>
        migrateLegacyMemory({
          workspaceRoot: runtime.workspaceRoot,
          memoryDir: runtime.memoryDir,
          dbPath: runtime.dbPath,
          dryRun: false,
          handle: runtime.handle,
        }),
      )
    }),
    renderMigration,
  )
}

function renderMigration(result: ReturnType<typeof migrateLegacyMemory>): void {
  if (result.alreadyCompleted) {
    console.log(
      result.dryRun
        ? 'Legacy migration already completed; dry run made no changes and did not scan generated projections.'
        : 'Legacy migration already completed; no artifacts were scanned or imported.',
    )
    return
  }
  console.log(
    result.dryRun ? 'Legacy migration dry run:' : 'Legacy migration complete:',
  )
  if (!result.items.length) console.log('- No legacy artifacts found.')
  for (const item of result.items)
    console.log(`- ${item.result}: ${item.path} (${item.kind}; ${item.detail})`)
}

async function handleConsolidate(
  dryRun: boolean,
  command: Command,
): Promise<void> {
  await runMemoryCommand(
    command,
    Effect.gen(function* () {
      const runtime = yield* MemoryRuntime
      return yield* consolidateMemory({
        dbPath: runtime.dbPath,
        memoryDir: runtime.memoryDir,
        dryRun,
        journal: makeJournalRepository(runtime.handle),
        consolidations: makeConsolidationRepository(runtime.handle),
      })
    }),
    (result) => {
      if (result.status === 'no-pending')
        return console.log('No pending journal entries.')
      if (result.status === 'preview') {
        console.log(
          `Consolidation preview: sequences ${result.firstSequence}-${result.lastSequence} (${result.entryCount} entries)`,
        )
        return
      }
      if (result.status === 'conflict') {
        console.warn(
          `Consolidation conflicted at boundary ${result.error.actualBoundary}; retry the command.`,
        )
        return
      }
      console.log(
        `Consolidated sequences ${result.consolidation.firstSequence}-${result.consolidation.lastSequence} (${result.entryCount} entries).`,
      )
      if (result.projection.stale)
        console.warn('Saved to SQLite, but generated Markdown is stale.')
    },
  )
}

async function handleAppend(
  kind: string,
  parts: string[],
  command: Command,
): Promise<void> {
  await runMemoryCommand(
    command,
    Effect.gen(function* () {
      const runtime = yield* MemoryRuntime
      return yield* appendMemory({
        dbPath: runtime.dbPath,
        nowPath: join(runtime.memoryDir, 'NOW.md'),
        input: { kind, content: parts.join(' ').trim() },
        repository: makeJournalRepository(runtime.handle),
      })
    }),
    (result) => {
      console.log(`Appended ${kind} entry to canonical memory.`)
      if (result.projection.stale)
        console.warn('Saved to SQLite, but NOW.md is stale.')
    },
  )
}
