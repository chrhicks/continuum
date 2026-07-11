import type { MemoryEvidence } from '../../memory/application/query'
import { truncate } from './summary-tasks'

export function renderMemorySummary(
  evidence: MemoryEvidence[],
  memoryLines: number,
): string {
  const pending = evidence.filter((item) => item.type === 'journal')
  const consolidations = evidence.filter(
    (item) => item.type === 'consolidation',
  )
  const recall = evidence.filter((item) => item.type.startsWith('recall-'))
  const lines = ['## Memory']
  lines.push(`- Pending journal entries: ${pending.length}`)
  lines.push(`- Recent consolidations: ${consolidations.length}`)
  lines.push(`- Recall evidence: ${recall.length}`)
  appendEvidence(lines, 'Pending Journal (raw)', pending, memoryLines)
  appendEvidence(lines, 'Recent Consolidations (derived)', consolidations, 3)
  appendEvidence(lines, 'Recent Recall Evidence', recall, 3)
  return lines.join('\n')
}

function appendEvidence(
  lines: string[],
  title: string,
  items: MemoryEvidence[],
  limit: number,
): void {
  if (items.length === 0) return
  lines.push('', `### ${title}`)
  for (const item of items.slice(0, limit)) {
    const content = item.content.replace(/\s+/g, ' ').trim()
    lines.push(
      `- [${item.provenance}/${item.type}] ${truncate(content, 160)} (${item.source})`,
    )
  }
}
