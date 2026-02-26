import { normalizeLimit } from './recall-util'

export type RecallSummaryChunkOptions = {
  maxChars: number
  maxLines: number
}

export type RecallSummaryChunk = {
  index: number
  total: number
  content: string
  charCount: number
  lineCount: number
  blockCount: number
}

type ChunkDraft = {
  blocks: string[]
  charCount: number
  lineCount: number
}

const DEFAULT_SEPARATOR = '\n\n'
const DEFAULT_SEPARATOR_LINES = 1

export function planRecallSummaryChunks(
  blocks: string[],
  options: RecallSummaryChunkOptions,
): RecallSummaryChunk[] {
  if (!Array.isArray(blocks)) {
    throw new Error('Summary blocks must be an array.')
  }
  const maxChars = normalizeLimit(options.maxChars, 'maxChars', 'Summary chunk')
  const maxLines = normalizeLimit(options.maxLines, 'maxLines', 'Summary chunk')

  if (blocks.length === 0) {
    return []
  }

  const drafts: ChunkDraft[] = []
  let current: ChunkDraft = { blocks: [], charCount: 0, lineCount: 0 }
  const separator = DEFAULT_SEPARATOR
  const separatorChars = separator.length
  const separatorLines = DEFAULT_SEPARATOR_LINES

  for (const block of blocks) {
    const blockText = block ?? ''
    const blockChars = blockText.length
    const blockLines = countLines(blockText)
    const needsSeparator = current.blocks.length > 0
    const nextChars =
      current.charCount + blockChars + (needsSeparator ? separatorChars : 0)
    const nextLines =
      current.lineCount + blockLines + (needsSeparator ? separatorLines : 0)

    if (
      current.blocks.length > 0 &&
      (nextChars > maxChars || nextLines > maxLines)
    ) {
      drafts.push(current)
      current = { blocks: [], charCount: 0, lineCount: 0 }
    }

    const addSeparator = current.blocks.length > 0
    current.blocks.push(blockText)
    current.charCount += blockChars + (addSeparator ? separatorChars : 0)
    current.lineCount += blockLines + (addSeparator ? separatorLines : 0)
  }

  if (current.blocks.length > 0) {
    drafts.push(current)
  }

  const total = drafts.length
  return drafts.map((draft, index) => {
    const content = draft.blocks.join(separator)
    return {
      index: index + 1,
      total,
      content,
      charCount: content.length,
      lineCount: countLines(content),
      blockCount: draft.blocks.length,
    }
  })
}

function countLines(value: string): number {
  if (!value) return 0
  return value.split('\n').length
}
