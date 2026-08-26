import { appendMemory } from '../../../memory/application/append'
import { consolidateMemory } from '../../../memory/application/consolidate'
import { migrateLegacyMemory } from '../../../memory/application/legacy-migrate'
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
import { resolveCliMemoryAccess, type CliInvocation } from '../../memory-access'
import { MemoryRuntime } from '../../../memory/runtime/memory-runtime'

export function registerMemoryHandlers(
  memory: Command,
  invocation: CliInvocation,
): void {
  registerMemorySubcommands(memory, {
    onAppend: (kind, parts, command) =>
      handleAppend(kind, parts, command, invocation),
    onConsolidate: (dryRun, command) =>
      handleConsolidate(dryRun, command, invocation),
    onMigrate: (dryRun, command) => handleMigrate(dryRun, command, invocation),
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
        invocation,
      ),
  })
}

async function handleMigrate(
  dryRun: boolean,
  command: Command,
  invocation: CliInvocation,
): Promise<void> {
  if (dryRun) {
    const access = resolveCliMemoryAccess(command, invocation, 'inspect')
    const context = access.workspace
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
      { cwd: context.workspaceRoot },
    )
    return
  }
  const access = resolveCliMemoryAccess(
    command,
    invocation,
    'claim-migrate-scoped',
  )
  await runMemoryCommand(
    command,
    access,
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
  invocation: CliInvocation,
): Promise<void> {
  const access = resolveCliMemoryAccess(
    command,
    invocation,
    'claim-migrate-scoped',
  )
  await runMemoryCommand(
    command,
    access,
    Effect.gen(function* () {
      const runtime = yield* MemoryRuntime
      return yield* consolidateMemory(runtime, { dryRun })
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
  invocation: CliInvocation,
): Promise<void> {
  const access = resolveCliMemoryAccess(
    command,
    invocation,
    'claim-migrate-scoped',
  )
  await runMemoryCommand(
    command,
    access,
    Effect.gen(function* () {
      const runtime = yield* MemoryRuntime
      return yield* appendMemory(runtime, {
        input: { kind, content: parts.join(' ').trim() },
      })
    }),
    (result) => {
      console.log(`Appended ${kind} entry to canonical memory.`)
      if (result.projection.stale)
        console.warn('Saved to SQLite, but NOW.md is stale.')
    },
  )
}
