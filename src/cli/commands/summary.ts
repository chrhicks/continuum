import { Command } from 'commander'
import { getWorkspaceContext } from '../../memory/paths'
import { parseOptionalPositiveInteger } from './shared'
import { loadTaskSummary, renderTaskSummary } from './summary-tasks'
import type { TaskSummary } from './summary-tasks'
import { renderMemorySummary } from './summary-memory'

type SummaryOptions = {
  limit?: string
  tasks?: boolean
  memory?: boolean
  memoryLines?: string
}

const DEFAULT_LIMIT = 5
const DEFAULT_MEMORY_LINES = 12

export function createSummaryCommand(): Command {
  return new Command('summary')
    .description('Show an agent-oriented briefing from tasks and memory')
    .option('--limit <n>', 'Max tasks per bucket', String(DEFAULT_LIMIT))
    .option(
      '--memory-lines <n>',
      'Max memory excerpt lines',
      String(DEFAULT_MEMORY_LINES),
    )
    .option('--no-tasks', 'Omit task summary')
    .option('--no-memory', 'Omit memory summary')
    .action(async (options: SummaryOptions) => {
      const limit = parseOptionalPositiveInteger(
        options.limit,
        DEFAULT_LIMIT,
        'Limit must be a positive integer.',
      )
      const memoryLines = parseOptionalPositiveInteger(
        options.memoryLines,
        DEFAULT_MEMORY_LINES,
        'Memory lines must be a positive integer.',
      )
      console.log(await renderSummary(options, limit, memoryLines))
    })
}

async function renderSummary(
  options: SummaryOptions,
  limit: number,
  memoryLines: number,
): Promise<string> {
  const context = getWorkspaceContext()
  const sections = [
    '# Continuum Summary',
    '',
    `Workspace: ${context.workspaceRoot}`,
  ]
  const taskSummary =
    options.tasks === false ? null : await loadTaskSummary(limit)

  if (taskSummary) {
    sections.push('', renderTaskSummary(taskSummary, limit))
  }
  if (options.memory !== false) {
    sections.push('', renderMemorySummary(memoryLines))
  }
  sections.push('', renderSuggestedCommands(taskSummary))
  return sections.join('\n')
}

function renderSuggestedCommands(summary: TaskSummary | null): string {
  const lines = ['## Suggested Commands']
  lines.push('- continuum guide')
  lines.push('- continuum guide task')
  if (summary?.nextTask) {
    lines.push(
      `- continuum task get ${summary.nextTask.id} --expand parent,children,blockers`,
    )
  } else if (summary?.initialized === false) {
    lines.push('- continuum init')
  } else if (summary?.completed.length) {
    lines.push(
      '- continuum task list --status completed --sort updatedAt --order desc --limit 5',
    )
  } else {
    lines.push(
      '- continuum task list --status ready --sort priority --order asc',
    )
  }
  lines.push('- continuum memory search "<query>"')
  return lines.join('\n')
}
