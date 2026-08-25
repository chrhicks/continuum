import {
  searchMemoryEvidence,
  type MemoryQueryOptions,
} from '../../../memory/application/query'
import type { Command } from 'commander'
import { Effect } from 'effect'
import { runMemoryCommand } from '../../io'
import { resolveCliMemoryAccess, type CliInvocation } from '../../memory-access'
import { MemoryRuntime } from '../../../memory/runtime/memory-runtime'

type HandleSearchInput = MemoryQueryOptions & { query: string }

export async function handleSearch(
  input: HandleSearchInput,
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
      return yield* searchMemoryEvidence(runtime, input.query, input)
    }),
    (matches) => {
      if (matches.length === 0) {
        console.log(`No matches found for "${input.query}".`)
        return
      }
      console.log(`Found ${matches.length} canonical memory matches:`)
      for (const match of matches) {
        const excerpt = match.content.replace(/\s+/g, ' ').trim().slice(0, 240)
        console.log(
          `- [${match.provenance}/${match.type}] score=${match.score} ${match.id} (${match.source}) ${excerpt}`,
        )
      }
    },
  )
}
