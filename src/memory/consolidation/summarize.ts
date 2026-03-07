import { mechanicalSummary, summarizeNow } from '../summarize'
import type { MemoryConfig } from '../config'
import type { MemorySummary } from '../types'
import type { PreparedConsolidationInput } from './extract'

export async function summarizePreparedInput(
  input: PreparedConsolidationInput,
  config: MemoryConfig,
): Promise<MemorySummary> {
  if (input.precomputedSummary) {
    return input.precomputedSummary
  }
  if (config.consolidation) {
    return summarizeNow(input.record.body, config.consolidation)
  }
  return mechanicalSummary(input.record.body)
}
