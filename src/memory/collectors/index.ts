import type { Task } from '../../task/types'
import type { OpencodeRecallSummary } from '../opencode/summary-parse'
import {
  buildCollectedRecord,
  extractFilePathsFromText,
  extractTaskIdsFromText,
  normalizeStringList,
} from './base'
import type { CollectedRecord } from '../types'

export type NormalizeNowRecordOptions = {
  sessionId: string
  body: string
  title?: string | null
  workspaceRoot?: string | null
  projectPath?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  tags?: Iterable<unknown> | null
  relatedTasks?: Iterable<unknown> | null
  metadata?: Record<string, unknown>
}

export type NormalizeOpencodeSessionRecordOptions = {
  sessionId: string
  projectId?: string | null
  workspaceRoot?: string | null
  title?: string | null
  transcript: string
  createdAt?: string | null
  updatedAt?: string | null
  tags?: Iterable<unknown> | null
  metadata?: Record<string, unknown>
}

export function normalizeNowRecord(
  options: NormalizeNowRecordOptions,
): CollectedRecord {
  const taskIds = normalizeStringList(options.relatedTasks)
  const inferredTaskIds = extractTaskIdsFromText(options.body)
  const filePaths = extractFilePathsFromText(options.body)

  return buildCollectedRecord({
    source: 'now',
    kind: 'session',
    externalId: options.sessionId,
    workspaceRoot: options.workspaceRoot ?? options.projectPath ?? null,
    title: options.title ?? `NOW session ${options.sessionId}`,
    body: options.body,
    createdAt: options.createdAt ?? null,
    updatedAt: options.updatedAt ?? options.createdAt ?? null,
    references: {
      tags: normalizeStringList(options.tags),
      taskIds: [...taskIds, ...inferredTaskIds],
      filePaths,
    },
    metadata: {
      session_id: options.sessionId,
      project_path: options.projectPath ?? null,
      ...(options.metadata ?? {}),
    },
  })
}

export function normalizeOpencodeSummaryRecord(
  summary: OpencodeRecallSummary,
): CollectedRecord {
  const body = [
    `Focus: ${summary.focus}`,
    formatSection('Decisions', summary.decisions),
    formatSection('Discoveries', summary.discoveries),
    formatSection('Patterns', summary.patterns),
    formatSection('Blockers', summary.blockers),
    formatSection('Open Questions', summary.openQuestions),
    formatSection('Next Steps', summary.nextSteps),
    formatSection('Tasks', summary.tasks),
    formatSection('Files', summary.files),
  ]
    .filter((section) => section.length > 0)
    .join('\n\n')

  return buildCollectedRecord({
    source: 'opencode',
    kind: 'summary',
    externalId: summary.sessionId,
    projectId: summary.projectId,
    workspaceRoot: summary.directory,
    title: summary.title ?? summary.focus,
    body,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    references: {
      tags: ['opencode', 'recall'],
      taskIds: summary.tasks,
      filePaths: summary.files,
    },
    metadata: {
      session_id: summary.sessionId,
      project_id: summary.projectId,
      directory: summary.directory,
      title: summary.title,
      focus: summary.focus,
      patterns: summary.patterns,
      blockers: summary.blockers,
      open_questions: summary.openQuestions,
      next_steps: summary.nextSteps,
      confidence: summary.confidence,
    },
  })
}

export function normalizeOpencodeSessionRecord(
  options: NormalizeOpencodeSessionRecordOptions,
): CollectedRecord {
  return buildCollectedRecord({
    source: 'opencode',
    kind: 'session',
    externalId: options.sessionId,
    projectId: options.projectId ?? null,
    workspaceRoot: options.workspaceRoot ?? null,
    title: options.title ?? `OpenCode session ${options.sessionId}`,
    body: options.transcript,
    createdAt: options.createdAt ?? null,
    updatedAt: options.updatedAt ?? options.createdAt ?? null,
    references: {
      tags: normalizeStringList(options.tags),
      taskIds: extractTaskIdsFromText(options.transcript),
      filePaths: extractFilePathsFromText(options.transcript),
    },
    metadata: {
      session_id: options.sessionId,
      ...(options.metadata ?? {}),
    },
  })
}

export function normalizeTaskRecord(
  task: Task,
  options: { workspaceRoot: string; includeBodyDetails?: boolean },
): CollectedRecord {
  const decisionLines = task.decisions.map((decision) =>
    decision.rationale
      ? `${decision.content} because ${decision.rationale}`
      : decision.content,
  )
  const discoveryLines = task.discoveries.map((discovery) => discovery.content)
  const blockedBy = normalizeStringList(task.blocked_by)
  const taskIds = [task.id, ...blockedBy]

  const sections = [
    `Task: ${task.title}`,
    task.intent ? `Intent: ${task.intent}` : '',
    task.description ? `Description: ${task.description}` : '',
    task.plan ? `Plan: ${task.plan}` : '',
    task.steps.length > 0 && options.includeBodyDetails !== false
      ? formatSection(
          'Steps',
          task.steps.map((step) => {
            const fragments = [step.title, step.description, step.status]
              .filter((fragment) => Boolean(fragment))
              .join(' - ')
            return fragments
          }),
        )
      : '',
    formatSection('Decisions', decisionLines),
    formatSection('Discoveries', discoveryLines),
    task.outcome ? `Outcome: ${task.outcome}` : '',
  ].filter((section) => section.length > 0)
  const body = sections.join('\n\n')

  return buildCollectedRecord({
    source: 'task',
    kind: 'task',
    externalId: task.id,
    workspaceRoot: options.workspaceRoot,
    title: task.title,
    body,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    references: {
      tags: [task.type, task.status],
      taskIds,
      filePaths: extractFilePathsFromText(body),
    },
    metadata: {
      task_id: task.id,
      type: task.type,
      status: task.status,
      priority: task.priority,
      parent_id: task.parent_id,
      blocked_by: blockedBy,
      completed_at: task.completed_at,
    },
  })
}

function formatSection(title: string, items: string[]): string {
  const normalized = normalizeStringList(items)
  if (normalized.length === 0) {
    return ''
  }
  return `${title}:\n${normalized.map((item) => `- ${item}`).join('\n')}`
}
