import { getMemoryConfig } from '../config'
import type { ResolvedSummaryConfig } from './opencode-artifacts'

const DEFAULT_SUMMARY_API_URL = 'https://opencode.ai/zen/v1/chat/completions'
const DEFAULT_SUMMARY_MAX_TOKENS = 4000
const DEFAULT_SUMMARY_TIMEOUT_MS = 120000
const DEFAULT_SUMMARY_MAX_CHARS = 40000
const DEFAULT_SUMMARY_MAX_LINES = 1200
const DEFAULT_SUMMARY_MERGE_MAX_EST_TOKENS = 12000

export type OpencodeSummaryOptionInput = {
  summarize?: boolean
  summaryModel?: string | null
  summaryApiKey?: string | null
  summaryApiUrl?: string | null
  summaryMaxTokens?: number | null
  summaryTimeoutMs?: number | null
  summaryMaxChars?: number | null
  summaryMaxLines?: number | null
  summaryMergeMaxEstTokens?: number | null
}

export function resolveSummaryConfig(
  options: OpencodeSummaryOptionInput,
): ResolvedSummaryConfig | null {
  if (options.summarize === false) {
    return null
  }
  const memoryConfig = getMemoryConfig().consolidation
  const apiKey =
    options.summaryApiKey ??
    process.env.OPENCODE_ZEN_API_KEY ??
    process.env.SUMMARY_API_KEY ??
    process.env.OPENAI_API_KEY ??
    memoryConfig?.api_key ??
    null
  const model =
    options.summaryModel ??
    process.env.SUMMARY_MODEL ??
    memoryConfig?.model ??
    null

  if (!apiKey || !model) {
    if (hasExplicitSummaryOverrides(options)) {
      throw new Error(
        'Incomplete OpenCode summary configuration. Provide both a summary API key and model.',
      )
    }
    return null
  }

  return {
    apiUrl:
      options.summaryApiUrl ??
      process.env.SUMMARY_API_URL ??
      memoryConfig?.api_url ??
      DEFAULT_SUMMARY_API_URL,
    apiKey,
    model,
    maxTokens:
      normalizePositiveInteger(options.summaryMaxTokens) ??
      memoryConfig?.max_tokens ??
      DEFAULT_SUMMARY_MAX_TOKENS,
    timeoutMs:
      normalizePositiveInteger(options.summaryTimeoutMs) ??
      memoryConfig?.timeout_ms ??
      DEFAULT_SUMMARY_TIMEOUT_MS,
    maxChars:
      normalizePositiveInteger(options.summaryMaxChars) ??
      DEFAULT_SUMMARY_MAX_CHARS,
    maxLines:
      normalizePositiveInteger(options.summaryMaxLines) ??
      DEFAULT_SUMMARY_MAX_LINES,
    mergeMaxEstTokens:
      normalizePositiveInteger(options.summaryMergeMaxEstTokens) ??
      DEFAULT_SUMMARY_MERGE_MAX_EST_TOKENS,
  }
}

function hasExplicitSummaryOverrides(
  options: OpencodeSummaryOptionInput,
): boolean {
  return [
    options.summaryModel,
    options.summaryApiKey,
    options.summaryApiUrl,
    options.summaryMaxTokens,
    options.summaryTimeoutMs,
    options.summaryMaxChars,
    options.summaryMaxLines,
    options.summaryMergeMaxEstTokens,
  ].some((value) => value !== undefined && value !== null)
}

function normalizePositiveInteger(
  value: number | null | undefined,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  const rounded = Math.round(value)
  return rounded > 0 ? rounded : null
}
