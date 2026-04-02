import type { MemorySummary } from './types'

export function formatFileList(files: string[], limit?: number): string {
  if (files.length === 0) {
    return 'none'
  }
  const wrapped = files.map((file) => `\`${file}\``)
  if (!limit || files.length <= limit) {
    return wrapped.join(', ')
  }
  const shown = wrapped.slice(0, limit).join(', ')
  const remaining = files.length - limit
  return `${shown} (+${remaining} more)`
}

export function buildSummaryLines(options: {
  summary: MemorySummary
  includeFiles: boolean
  sourceLabel?: string | null
}): string[] {
  const { summary } = options
  const lines: string[] = []
  if (options.sourceLabel) {
    lines.push(`**Source**: ${options.sourceLabel}`)
    lines.push('')
  }
  lines.push(summary.narrative)
  const sections: Array<{ heading: string; items: string[] }> = [
    { heading: '**Decisions**:', items: summary.decisions },
    { heading: '**Discoveries**:', items: summary.discoveries },
    { heading: '**Patterns**:', items: summary.patterns },
    { heading: '**What worked**:', items: summary.whatWorked },
    { heading: "**What didn't work**:", items: summary.whatFailed },
    { heading: '**Blockers**:', items: summary.blockers },
    { heading: '**Open questions**:', items: summary.openQuestions },
    { heading: '**Next steps**:', items: summary.nextSteps },
  ]

  for (const section of sections) {
    if (section.items.length === 0) {
      continue
    }
    lines.push('')
    lines.push(section.heading)
    lines.push(...section.items.map((item) => `- ${item}`))
  }

  if (summary.tasks.length > 0) {
    lines.push('')
    lines.push(`**Tasks**: ${summary.tasks.join(', ')}`)
  }

  if (options.includeFiles && summary.files.length > 0) {
    lines.push('')
    lines.push(`**Files**: ${formatFileList(summary.files)}`)
  }

  return lines
}
