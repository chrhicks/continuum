import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Config, Effect, Option, Redacted } from 'effect'
import { parse } from 'yaml'
import { memoryPath } from './paths'

export type ConsolidationLlmConfig = {
  api_url: string
  api_key: string
  model: string
  max_tokens: number
  timeout_ms: number
  summary_max_chars: number
  summary_max_lines: number
  merge_max_est_tokens: number
}

export type MemoryConfig = {
  now_max_lines: number
  now_max_hours: number
  recent_session_count: number
  recent_max_lines: number
  memory_sections: string[]
  consolidation?: ConsolidationLlmConfig
}

type SummaryEnvironment = {
  zenApiKey?: string
  consolidationApiKey?: string
  summaryApiKey?: string
  openaiApiKey?: string
  summaryModel?: string
  consolidationModel?: string
  summaryApiUrl?: string
}

const DEFAULT_SECTIONS = [
  'Architecture Decisions',
  'Technical Discoveries',
  'Development Patterns',
]
const DEFAULT_CONSOLIDATION_MAX_TOKENS = 4000
const DEFAULT_CONSOLIDATION_TIMEOUT_MS = 120000
const DEFAULT_CONSOLIDATION_API_URL = 'https://opencode.ai/zen/v1/responses'
const DEFAULT_CONSOLIDATION_MODEL = 'gpt-5.4-mini'
const DEFAULT_CONSOLIDATION_SUMMARY_MAX_CHARS = 40000
const DEFAULT_CONSOLIDATION_SUMMARY_MAX_LINES = 1200
const DEFAULT_CONSOLIDATION_MERGE_MAX_EST_TOKENS = 12000

const DEFAULT_CONFIG: MemoryConfig = {
  now_max_lines: 200,
  now_max_hours: 6,
  recent_session_count: 3,
  recent_max_lines: 500,
  memory_sections: [...DEFAULT_SECTIONS, 'Sessions'],
}

const summaryEnvironmentConfig = Config.all({
  zenApiKey: Config.option(Config.redacted('OPENCODE_ZEN_API_KEY')),
  consolidationApiKey: Config.option(Config.redacted('CONSOLIDATION_API_KEY')),
  summaryApiKey: Config.option(Config.redacted('SUMMARY_API_KEY')),
  openaiApiKey: Config.option(Config.redacted('OPENAI_API_KEY')),
  summaryModel: Config.option(Config.string('SUMMARY_MODEL')),
  consolidationModel: Config.option(Config.string('CONSOLIDATION_MODEL')),
  summaryApiUrl: Config.option(Config.string('SUMMARY_API_URL')),
})

const loadSummaryEnvironment = Effect.fn('MemoryConfig.loadSummaryEnvironment')(
  function* () {
    const values = yield* summaryEnvironmentConfig
    return {
      zenApiKey: optionRedacted(values.zenApiKey),
      consolidationApiKey: optionRedacted(values.consolidationApiKey),
      summaryApiKey: optionRedacted(values.summaryApiKey),
      openaiApiKey: optionRedacted(values.openaiApiKey),
      summaryModel: optionString(values.summaryModel),
      consolidationModel: optionString(values.consolidationModel),
      summaryApiUrl: optionString(values.summaryApiUrl),
    }
  },
)

export const loadMemoryConfig = Effect.fn('MemoryConfig.load')(function* (
  memoryDir?: string,
) {
  const environment = yield* loadSummaryEnvironment()
  const configPath = memoryDir
    ? join(memoryDir, 'config.yml')
    : memoryPath('config.yml')
  const raw = readConfigFile(configPath)
  return normalizeConfig(raw, environment)
})

function readConfigFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null
  try {
    const value: unknown = parse(readFileSync(path, 'utf8'))
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function normalizeConfig(
  raw: Record<string, unknown> | null,
  environment: SummaryEnvironment,
): MemoryConfig {
  return {
    now_max_lines: readPositiveInt(
      raw?.now_max_lines,
      DEFAULT_CONFIG.now_max_lines,
    ),
    now_max_hours: readPositiveNumber(
      raw?.now_max_hours,
      DEFAULT_CONFIG.now_max_hours,
    ),
    recent_session_count: readPositiveInt(
      raw?.recent_session_count,
      DEFAULT_CONFIG.recent_session_count,
    ),
    recent_max_lines: readPositiveInt(
      raw?.recent_max_lines,
      DEFAULT_CONFIG.recent_max_lines,
    ),
    memory_sections: normalizeSections(raw?.memory_sections),
    consolidation: resolveConsolidationConfig(raw?.consolidation, environment),
  }
}

function resolveConsolidationConfig(
  raw: unknown,
  environment: SummaryEnvironment,
): ConsolidationLlmConfig | undefined {
  const record = isRecord(raw) ? raw : null
  const apiKey =
    readNonEmptyString(record?.api_key) ??
    environment.zenApiKey ??
    environment.summaryApiKey ??
    environment.consolidationApiKey ??
    environment.openaiApiKey
  const model =
    readNonEmptyString(record?.model) ??
    environment.summaryModel ??
    environment.consolidationModel ??
    (apiKey ? DEFAULT_CONSOLIDATION_MODEL : undefined)
  if (!apiKey || !model) return undefined

  return {
    api_url:
      readNonEmptyString(record?.api_url) ??
      environment.summaryApiUrl ??
      DEFAULT_CONSOLIDATION_API_URL,
    api_key: apiKey,
    model,
    max_tokens: readPositiveInt(
      record?.max_tokens,
      DEFAULT_CONSOLIDATION_MAX_TOKENS,
    ),
    timeout_ms: readPositiveInt(
      record?.timeout_ms,
      DEFAULT_CONSOLIDATION_TIMEOUT_MS,
    ),
    summary_max_chars: readPositiveInt(
      record?.summary_max_chars,
      DEFAULT_CONSOLIDATION_SUMMARY_MAX_CHARS,
    ),
    summary_max_lines: readPositiveInt(
      record?.summary_max_lines,
      DEFAULT_CONSOLIDATION_SUMMARY_MAX_LINES,
    ),
    merge_max_est_tokens: readPositiveInt(
      record?.merge_max_est_tokens,
      DEFAULT_CONSOLIDATION_MERGE_MAX_EST_TOKENS,
    ),
  }
}

function optionRedacted(
  value: Option.Option<Redacted.Redacted>,
): string | undefined {
  return Option.isSome(value)
    ? (readNonEmptyString(Redacted.value(value.value)) ?? undefined)
    : undefined
}

function optionString(value: Option.Option<string>): string | undefined {
  return readNonEmptyString(Option.getOrUndefined(value)) ?? undefined
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.round(value)
  return rounded > 0 ? rounded : fallback
}

function readPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback
}

function normalizeSections(value: unknown): string[] {
  const provided = Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : []
  const sections = provided.length > 0 ? provided : [...DEFAULT_SECTIONS]
  for (const fallback of DEFAULT_SECTIONS) {
    if (sections.length >= 3) break
    if (!sections.includes(fallback)) sections.push(fallback)
  }
  if (!sections.includes('Sessions')) sections.push('Sessions')
  return sections
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
