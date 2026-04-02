import { serializeFrontmatter } from '../../utils/frontmatter'
import type { OpencodeSessionBundle } from '../opencode/extract'
import {
  RECALL_SUMMARY_KEYWORD_GROUPS,
  type RecallSummaryResult,
} from '../opencode/summary-schema'
import type { OpencodeRecallSummary } from '../opencode/summary-parse'
import {
  countKeywords,
  dedupeStrings,
  normalizeConfidence,
  normalizeKeywords,
  normalizeWhitespace as normalizeWhitespaceValue,
  renderKeywordList,
  renderSummaryList,
} from './opencode-summary-normalization'

export type NormalizedOpencodeMessage = {
  id: string
  role: string
  createdAt: string | null
  text: string
}

export type ResolvedSummaryConfig = {
  apiUrl: string
  apiKey: string
  model: string
  maxTokens: number
  timeoutMs: number
  maxChars: number
  maxLines: number
  mergeMaxEstTokens: number
}

export function renderNormalizedMessageBlock(
  message: NormalizedOpencodeMessage,
): string {
  const roleLabel =
    message.role === 'assistant'
      ? 'Agent'
      : message.role === 'user'
        ? 'User'
        : capitalize(message.role)
  const timeLabel = message.createdAt ? ` (${message.createdAt})` : ''
  return `### ${roleLabel}${timeLabel}\n\n${message.text}`
}

export function buildNormalizedSessionDoc(
  session: OpencodeSessionBundle,
  projectId: string,
  messages: NormalizedOpencodeMessage[],
): string {
  const frontmatter = serializeFrontmatter({
    source: 'opencode',
    session_id: session.session.id,
    project_id: projectId,
    directory: session.session.directory ?? null,
    slug: session.session.slug ?? null,
    title: session.session.title ?? null,
    created_at: toIso(session.session.time?.created),
    updated_at: toIso(session.session.time?.updated),
    message_count: messages.length,
    normalized: true,
  })
  const title =
    session.session.title?.trim() || session.session.slug || session.session.id
  return [
    frontmatter,
    '',
    `# Session: ${title}`,
    '',
    '## Transcript',
    '',
    ...messages.map((message) => renderNormalizedMessageBlock(message)),
    '',
  ].join('\n')
}

export function buildSummaryDoc(
  session: OpencodeSessionBundle,
  projectId: string,
  summary: RecallSummaryResult,
  config: ResolvedSummaryConfig,
  summaryChunkCount: number,
): string {
  const keywordTotal = countKeywords(summary.keywords)
  const frontmatter = serializeFrontmatter({
    source: 'opencode',
    session_id: session.session.id,
    project_id: projectId,
    directory: session.session.directory ?? null,
    slug: session.session.slug ?? null,
    title: session.session.title ?? null,
    created_at: toIso(session.session.time?.created),
    updated_at: toIso(session.session.time?.updated),
    summary_model: config.model,
    summary_chunks: summaryChunkCount,
    summary_max_chars: config.maxChars,
    summary_max_lines: config.maxLines,
    summary_generated_at: new Date().toISOString(),
    summary_keyword_total: keywordTotal,
  })
  const title =
    session.session.title?.trim() || session.session.slug || session.session.id
  return [
    frontmatter,
    '',
    `# Session Summary: ${title}`,
    '',
    '## Focus',
    '',
    summary.focus || 'none',
    '',
    '## Decisions',
    '',
    ...renderSummaryList(summary.decisions),
    '',
    '## Discoveries',
    '',
    ...renderSummaryList(summary.discoveries),
    '',
    '## Patterns',
    '',
    ...renderSummaryList(summary.patterns),
    '',
    '## Tasks',
    '',
    ...renderSummaryList(summary.tasks),
    '',
    '## Files',
    '',
    ...renderSummaryList(summary.files),
    '',
    '## Keywords',
    '',
    ...renderKeywordList(summary.keywords),
    '',
    '## Blockers',
    '',
    ...renderSummaryList(summary.blockers),
    '',
    '## Open Questions',
    '',
    ...renderSummaryList(summary.open_questions),
    '',
    '## Next Steps',
    '',
    ...renderSummaryList(summary.next_steps),
    '',
    `## Confidence (${summary.confidence})`,
    '',
    '',
  ].join('\n')
}

export function buildSummaryMeta(
  session: OpencodeSessionBundle,
  projectId: string,
  summary: RecallSummaryResult,
  config: ResolvedSummaryConfig,
  summaryChunkCount: number,
): Record<string, unknown> {
  return {
    session_id: session.session.id,
    project_id: projectId,
    directory: session.session.directory ?? null,
    title: session.session.title ?? null,
    summary_model: config.model,
    summary_generated_at: new Date().toISOString(),
    summary_chunks: summaryChunkCount,
    summary_max_chars: config.maxChars,
    summary_max_lines: config.maxLines,
    summary_keyword_total: countKeywords(summary.keywords),
    confidence: summary.confidence,
  }
}

export function buildOpencodeRecallSummary(
  session: OpencodeSessionBundle,
  projectId: string,
  summary: RecallSummaryResult,
): OpencodeRecallSummary {
  return {
    sessionId: session.session.id,
    projectId,
    createdAt: toIso(session.session.time?.created) ?? new Date().toISOString(),
    updatedAt:
      toIso(session.session.time?.updated) ??
      toIso(session.session.time?.created) ??
      new Date().toISOString(),
    directory: session.session.directory ?? null,
    title: session.session.title ?? session.session.slug ?? null,
    focus: summary.focus,
    decisions: summary.decisions,
    discoveries: summary.discoveries,
    patterns: summary.patterns,
    blockers: summary.blockers,
    openQuestions: summary.open_questions,
    nextSteps: summary.next_steps,
    tasks: summary.tasks,
    files: summary.files,
    confidence: summary.confidence === 'med' ? 'medium' : summary.confidence,
  }
}

export function normalizeSummary(
  summary: RecallSummaryResult,
  allowedFiles: string[],
): RecallSummaryResult {
  const allowed = new Set(allowedFiles)
  return {
    focus: normalizeWhitespace(summary.focus),
    decisions: dedupeStrings(summary.decisions),
    discoveries: dedupeStrings(summary.discoveries),
    patterns: dedupeStrings(summary.patterns),
    tasks: dedupeStrings(summary.tasks),
    files: dedupeStrings(summary.files).filter((file) => allowed.has(file)),
    blockers: dedupeStrings(summary.blockers),
    open_questions: dedupeStrings(summary.open_questions),
    next_steps: dedupeStrings(summary.next_steps),
    confidence: normalizeConfidence(summary.confidence),
    keywords: normalizeKeywords(summary.keywords, allowed),
  }
}

export function toIso(value?: number | null): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  return new Date(value).toISOString()
}

export function normalizeWhitespace(value: string): string {
  return normalizeWhitespaceValue(value)
}

function capitalize(value: string): string {
  if (!value) {
    return 'Unknown'
  }
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}
