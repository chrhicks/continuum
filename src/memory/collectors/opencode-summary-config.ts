import type { MemoryConfig } from '../config'
import type { ResolvedSummaryConfig } from './opencode-artifacts'

export function resolveSummaryConfig(
  memory: MemoryConfig,
): ResolvedSummaryConfig | null {
  const consolidation = memory.consolidation
  if (!consolidation) return null
  return {
    apiUrl: consolidation.api_url,
    apiKey: consolidation.api_key,
    model: consolidation.model,
    maxTokens: consolidation.max_tokens,
    timeoutMs: consolidation.timeout_ms,
    maxChars: consolidation.summary_max_chars,
    maxLines: consolidation.summary_max_lines,
    mergeMaxEstTokens: consolidation.merge_max_est_tokens,
  }
}
