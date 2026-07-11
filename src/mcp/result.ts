import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { Effect } from 'effect'

export function toolResult<T extends Record<string, unknown>>(
  result: T,
  render: (result: T) => string = (value) => JSON.stringify(value, null, 2),
): CallToolResult {
  return {
    content: [{ type: 'text' as const, text: render(result) }],
    structuredContent: result,
  }
}

export async function runMcpEffect<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.mapError(mcpError)))
}

function mcpError(cause: unknown): Error {
  if (cause instanceof Error && cause.message) return cause
  if (cause && typeof cause === 'object' && 'cause' in cause) {
    return mcpError(cause.cause)
  }
  if (cause && typeof cause === 'object' && '_tag' in cause) {
    return new Error(String(cause._tag))
  }
  return new Error(String(cause))
}
