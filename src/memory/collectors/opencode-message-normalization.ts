import type { OpencodeMessageBlock } from '../opencode/extract'
import {
  normalizeWhitespace,
  renderNormalizedMessageBlock,
  toIso,
  type NormalizedOpencodeMessage,
} from './opencode-artifacts'

export function normalizeSessionMessages(
  messageBlocks: OpencodeMessageBlock[],
): NormalizedOpencodeMessage[] {
  return messageBlocks
    .map(({ message, parts }) => {
      const text = normalizeWhitespace(
        parts
          .filter(
            (part) => part.type === 'text' && typeof part.text === 'string',
          )
          .map((part) => part.text as string)
          .join('\n'),
      )
      const fallback = normalizeWhitespace(message.summary?.title ?? '')
      const finalText = text || fallback
      if (!finalText) {
        return null
      }
      return {
        id: message.id,
        role: message.role ?? 'unknown',
        createdAt: toIso(message.time?.created),
        text: finalText,
      }
    })
    .filter((message): message is NormalizedOpencodeMessage => message !== null)
}

export function buildNormalizedTranscript(
  messages: NormalizedOpencodeMessage[],
): string {
  return messages.map(renderNormalizedMessageBlock).join('\n\n')
}
