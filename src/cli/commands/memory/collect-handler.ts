import { collectOpencodeRecords } from '../../../memory/collectors/opencode'
import { collectTaskRecords } from '../../../memory/collectors/task'
import { consolidatePreparedInputs } from '../../../memory/consolidate'
import { prepareCollectedRecordConsolidationInput } from '../../../memory/consolidation/extract'
import { getWorkspaceContext, memoryPath } from '../../../memory/paths'
import { importOpencodeRecall } from '../../../memory/recall-import'
import { createDbMemoryStateRepository } from '../../../memory/state/db-repository'
import { parseOptionalPositiveInteger } from '../shared'
import type { CollectOptions } from './memory-subcommands'

type CollectSource = 'opencode' | 'task'

type CollectIntegerOption =
  | 'limit'
  | 'summaryMaxTokens'
  | 'summaryTimeoutMs'
  | 'summaryMaxChars'
  | 'summaryMaxLines'
  | 'summaryMergeMaxEstTokens'

const COLLECT_INTEGER_OPTION_ERRORS: Record<CollectIntegerOption, string> = {
  limit: 'Collect limit must be a positive integer.',
  summaryMaxTokens: 'Summary max tokens must be a positive integer.',
  summaryTimeoutMs: 'Summary timeout must be a positive integer.',
  summaryMaxChars: 'Summary max chars must be a positive integer.',
  summaryMaxLines: 'Summary max lines must be a positive integer.',
  summaryMergeMaxEstTokens:
    'Summary merge token budget must be a positive integer.',
}

export async function handleCollect(options: CollectOptions): Promise<void> {
  const source = parseCollectSource(options.source)
  const workspace = getWorkspaceContext()
  const checkpointRepository = createCheckpointRepository(workspace)

  if (source === 'task') {
    await collectFromTaskSource(options, workspace, checkpointRepository)
    return
  }

  await collectFromOpencodeSource(options, checkpointRepository)
}

function parseCollectSource(sourceValue?: string): CollectSource {
  const source = (sourceValue ?? 'opencode').trim().toLowerCase()
  if (source !== 'opencode' && source !== 'task') {
    throw new Error(`Unsupported collect source: ${source}`)
  }
  return source
}

function createCheckpointRepository(
  workspace: ReturnType<typeof getWorkspaceContext>,
) {
  return createDbMemoryStateRepository({
    dbPath: workspace.continuumDbPath,
    legacyFilePath: memoryPath('collect-state.json'),
  })
}

async function collectFromTaskSource(
  options: CollectOptions,
  workspace: ReturnType<typeof getWorkspaceContext>,
  checkpointRepository: ReturnType<typeof createCheckpointRepository>,
): Promise<void> {
  const result = await collectTaskRecords(
    {
      directory: workspace.workspaceRoot,
      taskId: options.task ?? null,
      statuses: parseTaskCollectStatuses(options.status),
      limit: parseCollectIntegerOption(options, 'limit'),
    },
    { stateRepository: checkpointRepository },
  )

  if (result.items.length > 0) {
    await consolidatePreparedInputs(
      result.items.map((item) =>
        prepareCollectedRecordConsolidationInput({
          record: item.record,
          sourcePath: `${workspace.continuumDbPath}#task:${item.task.id}`,
          sessionId: item.task.id,
          tags: item.record.references.tags,
          precomputedSummary: item.summary,
        }),
      ),
      { skipSourceCleanup: true },
    )
  }

  printTaskCollectionSummary(result)
}

async function collectFromOpencodeSource(
  options: CollectOptions,
  checkpointRepository: ReturnType<typeof createCheckpointRepository>,
): Promise<void> {
  const result = await collectOpencodeRecords(
    {
      dbPath: options.db ?? null,
      repoPath: options.repo ?? null,
      outDir: options.out ?? null,
      projectId: options.project ?? null,
      sessionId: options.session ?? null,
      limit: parseCollectIntegerOption(options, 'limit'),
      summarize: options.summarize,
      summaryModel: options.summaryModel ?? null,
      summaryApiUrl: options.summaryApiUrl ?? null,
      summaryApiKey: options.summaryApiKey ?? null,
      summaryMaxTokens: parseCollectIntegerOption(options, 'summaryMaxTokens'),
      summaryTimeoutMs: parseCollectIntegerOption(options, 'summaryTimeoutMs'),
      summaryMaxChars: parseCollectIntegerOption(options, 'summaryMaxChars'),
      summaryMaxLines: parseCollectIntegerOption(options, 'summaryMaxLines'),
      summaryMergeMaxEstTokens: parseCollectIntegerOption(
        options,
        'summaryMergeMaxEstTokens',
      ),
    },
    { stateRepository: checkpointRepository },
  )

  let imported = null
  if (options.import) {
    if (result.artifacts.summaries.length === 0) {
      throw new Error(
        'No summary docs were generated. Run with summarization enabled before using --import.',
      )
    }
    imported = await importOpencodeRecall({
      summaryDir: result.outDir,
      projectId: options.project ?? undefined,
      sessionId: options.session ?? undefined,
    })
  }

  printOpencodeCollectionSummary(result, imported)
}

function parseCollectIntegerOption(
  options: CollectOptions,
  key: CollectIntegerOption,
): number | null {
  return parseOptionalPositiveInteger(
    options[key],
    null,
    COLLECT_INTEGER_OPTION_ERRORS[key],
  )
}

function printTaskCollectionSummary(
  result: Awaited<ReturnType<typeof collectTaskRecords>>,
): void {
  console.log('Memory collect:')
  console.log('- Source: task')
  console.log(`- Workspace: ${result.directory}`)
  console.log(`- Tasks examined: ${result.tasksExamined}`)
  console.log(`- Task records emitted: ${result.records.length}`)
  console.log(`- Skipped unchanged: ${result.skippedUnchanged}`)
  if (result.checkpoint) {
    console.log(`- Checkpoint: ${result.checkpoint.key}`)
  }
}

function printOpencodeCollectionSummary(
  result: Awaited<ReturnType<typeof collectOpencodeRecords>>,
  imported: Awaited<ReturnType<typeof importOpencodeRecall>> | null,
): void {
  console.log('Memory collect:')
  console.log('- Source: opencode')
  console.log(`- Project: ${result.projectId}`)
  console.log(`- Repo: ${result.repoPath}`)
  console.log(`- Output dir: ${result.outDir}`)
  console.log(`- Sessions processed: ${result.sessionsProcessed}`)
  console.log(`- Records emitted: ${result.records.length}`)
  console.log(`- Normalized docs: ${result.artifacts.normalized.length}`)
  console.log(`- Summary docs: ${result.artifacts.summaries.length}`)
  if (result.checkpoint) {
    console.log(`- Checkpoint: ${result.checkpoint.key}`)
  }
  if (imported) {
    console.log(`- Imported summaries: ${imported.imported}`)
  }
}

function parseTaskCollectStatuses(
  value?: string,
): Array<'open' | 'ready' | 'blocked' | 'completed' | 'cancelled'> | null {
  if (!value) {
    return null
  }
  const valid = new Set(['open', 'ready', 'blocked', 'completed', 'cancelled'])
  const statuses = value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)

  if (statuses.length === 0) {
    throw new Error('Task status filter must include at least one status.')
  }
  for (const status of statuses) {
    if (!valid.has(status)) {
      throw new Error(
        'Invalid task status filter. Use: open, ready, blocked, completed, cancelled.',
      )
    }
  }
  return statuses as Array<
    'open' | 'ready' | 'blocked' | 'completed' | 'cancelled'
  >
}
