import { spawnSync } from 'node:child_process'
import type {
  OpencodeSyncPlan,
  OpencodeSyncPlanItem,
} from '../diff/opencode-diff'

export type OpencodeSyncProcessResult = {
  item: OpencodeSyncPlanItem
  status: 'success' | 'failed' | 'skipped'
  command: string | null
  error: string | null
}

export type OpencodeSyncRunSummary = {
  success: number
  failed: number
  skipped: number
}

type CommandResult = {
  ok: boolean
  code: number | null
  error: string | null
}

const projectFlagPattern = /--project(?:-id)?(?=\s|=|$)/

export function adjustTemplateForScope(
  template: string | null,
  plan: OpencodeSyncPlan,
): { template: string | null; appended: boolean; warning: string | null } {
  if (!template || !plan.project_scope?.include_global) {
    return { template, appended: false, warning: null }
  }

  if (template.includes('{project_id}')) {
    return { template, appended: false, warning: null }
  }

  if (projectFlagPattern.test(template)) {
    return {
      template,
      appended: false,
      warning:
        'Plan includes global sessions but command template does not reference {project_id}.',
    }
  }

  return {
    template: `${template} --project {project_id}`,
    appended: true,
    warning: null,
  }
}

export function limitSyncPlanItems(
  items: OpencodeSyncPlanItem[],
  limit: number | null,
): OpencodeSyncPlanItem[] {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return items
  return items.slice(0, limit)
}

export function processSyncPlanItem(
  item: OpencodeSyncPlanItem,
  options: {
    commandTemplate: string | null
    cwd: string
    dryRun: boolean
  },
): OpencodeSyncProcessResult {
  if (!options.commandTemplate) {
    return {
      item,
      status: 'skipped',
      command: null,
      error: 'missing-command-template',
    }
  }

  const command = applyTemplate(options.commandTemplate, item)
  if (options.dryRun) {
    return {
      item,
      status: 'skipped',
      command,
      error: 'dry-run',
    }
  }

  const result = runCommand(command, options.cwd)
  return {
    item,
    status: result.ok ? 'success' : 'failed',
    command,
    error: result.error,
  }
}

export function summarizeSyncRunResults(
  results: OpencodeSyncProcessResult[],
): OpencodeSyncRunSummary {
  return results.reduce<OpencodeSyncRunSummary>(
    (acc, result) => ({
      ...acc,
      [result.status]: acc[result.status] + 1,
    }),
    { success: 0, failed: 0, skipped: 0 },
  )
}

function applyTemplate(template: string, item: OpencodeSyncPlanItem): string {
  return template
    .split('{session_id}')
    .join(item.session_id)
    .split('{project_id}')
    .join(item.project_id)
    .split('{key}')
    .join(item.key)
}

function runCommand(command: string, cwd: string): CommandResult {
  try {
    const result = spawnSync(command, {
      shell: true,
      stdio: 'inherit',
      cwd,
    })
    return {
      ok: result.status === 0,
      code: result.status ?? null,
      error: result.error ? String(result.error.message ?? result.error) : null,
    }
  } catch (error) {
    return {
      ok: false,
      code: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
