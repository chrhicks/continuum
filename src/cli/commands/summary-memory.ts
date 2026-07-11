import type { MemoryEvidence } from '../../memory/application/query'

export function renderMemorySummary(
  evidence: MemoryEvidence[],
  summaryLimit: number,
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
  appendEvidence(lines, 'Pending Journal (raw)', pending)
  appendEvidence(
    lines,
    'Recent Consolidations (derived)',
    consolidations.slice(0, summaryLimit),
  )
  appendEvidence(lines, 'Recent Recall Evidence', recall.slice(0, summaryLimit))
  return lines.join('\n')
}

function appendEvidence(
  lines: string[],
  title: string,
  items: MemoryEvidence[],
): void {
  if (items.length === 0) return
  lines.push('', `### ${title}`)
  for (const item of items) {
    lines.push(
      '',
      `#### ${formatEvidenceType(item)}`,
      '',
      `_Source: ${item.source}_`,
      '',
      cleanMemoryContent(item.content),
    )
  }
}

function formatEvidenceType(item: MemoryEvidence): string {
  const type = item.type.replaceAll('-', ' ')
  return `${item.provenance === 'raw' ? 'Raw' : 'Derived'} ${type}`
}

function cleanMemoryContent(content: string): string {
  return content
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .replace(/^<a\s+name=["'][^"']+["']><\/a>\s*$/gm, '')
    .replace(/^\*\*Link\*\*:\s*\[[^\]]+\]\([^\n]+\)\s*$/gm, '')
    .replace(/^# Consolidated Memory\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
