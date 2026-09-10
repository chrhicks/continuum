import type { Redacted } from 'effect'
import { normalizeWhitespace as normalizeWhitespaceValue } from './opencode-summary-normalization'

export type NormalizedOpencodeMessage = {
  id: string
  role: string
  createdAt: string | null
  text: string
}

export type ResolvedSummaryConfig = {
  apiUrl: string
  apiKey: Redacted.Redacted<string>
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
