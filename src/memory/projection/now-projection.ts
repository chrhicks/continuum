import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { JournalEntry } from '../domain/journal-entry'
import { writeFileAtomically } from '../file-io'

export function renderNowProjection(entries: readonly JournalEntry[]): string {
  const body = entries.map(renderEntry).join('\n\n')
  return `---
memory_type: NOW
generated: true
authoritative: false
---

# Pending Memory
${body ? `\n${body}\n` : ''}`
}

export function publishNowProjection(
  path: string,
  entries: readonly JournalEntry[],
): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileAtomically(path, renderNowProjection(entries))
}

function renderEntry(entry: JournalEntry): string {
  if (entry.kind === 'user') return `## User: ${entry.content}`
  if (entry.kind === 'agent') return `## Agent: ${entry.content}`
  if (entry.kind === 'tool') return `[Tool: ${entry.content}]`
  return `## ${entry.kind}: ${entry.content}`
}
