import {
  searchMemoryEvidence,
  type MemoryQueryOptions,
} from '../../../memory/application/query'
import { getWorkspaceContext } from '../../../memory/paths'
import type { Command } from 'commander'
import { Effect } from 'effect'
import { runMemoryCommand } from '../../io'
import { MemoryRuntime } from '../../../memory/runtime/memory-runtime'

type HandleSearchInput = MemoryQueryOptions & { query: string }

export async function handleSearch(
  input: HandleSearchInput,
  command: Command,
): Promise<void> {
  await runMemoryCommand(
    command,
    Effect.gen(function* () {
      const runtime = yield* MemoryRuntime
      return yield* searchMemoryEvidence(
        runtime.dbPath,
        input.query,
        input,
        runtime.handle,
      )
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
