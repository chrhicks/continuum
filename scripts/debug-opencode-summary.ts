import { createHash } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { createLlmClient } from '../src/llm/client'
import { normalizeSessionMessages } from '../src/memory/collectors/opencode-message-normalization'
import { renderNormalizedMessageBlock } from '../src/memory/collectors/opencode-artifacts'
import {
  resolveSummaryConfig,
  type OpencodeSummaryOptionInput,
} from '../src/memory/collectors/opencode-summary-config'
import { summarizeOpencodeSession } from '../src/memory/collectors/opencode-summary'
import { extractOpencodeSessions } from '../src/memory/opencode/extract'
import { planRecallSummaryChunks } from '../src/memory/opencode/summary-chunks'

type CliOptions = OpencodeSummaryOptionInput & {
  repoPath: string
  sessionId: string
  dbPath: string | null
  outDir: string | null
  projectId: string | null
  allowLiveChunks: boolean
}

async function main(): Promise<void> {
  if (
    process.argv.slice(2).includes('--help') ||
    process.argv.slice(2).includes('-h')
  ) {
    printUsage()
    return
  }
  const options = parseArgs(process.argv.slice(2))
  if (!options) {
    printUsage()
    process.exitCode = 1
    return
  }

  process.chdir(options.repoPath)

  const summaryConfig = resolveSummaryConfig({
    summarize: true,
    summaryModel: options.summaryModel,
    summaryApiKey: options.summaryApiKey,
    summaryApiUrl: options.summaryApiUrl,
    summaryMaxTokens: options.summaryMaxTokens,
    summaryTimeoutMs: options.summaryTimeoutMs,
    summaryMaxChars: options.summaryMaxChars,
    summaryMaxLines: options.summaryMaxLines,
    summaryMergeMaxEstTokens: options.summaryMergeMaxEstTokens,
  })
  if (!summaryConfig) {
    throw new Error(
      'Missing summary configuration. Pass flags or set memory config/environment variables.',
    )
  }

  const extraction = extractOpencodeSessions({
    repoPath: options.repoPath,
    dbPath: options.dbPath,
    outDir: options.outDir,
    projectId: options.projectId,
    sessionId: options.sessionId,
    limit: 1,
  })
  const session = extraction.sessions[0]
  if (!session) {
    throw new Error(`No session found for ${options.sessionId}`)
  }

  const messages = normalizeSessionMessages(session.messageBlocks)
  const chunks = planRecallSummaryChunks(
    messages.map(renderNormalizedMessageBlock),
    {
      maxChars: summaryConfig.maxChars,
      maxLines: summaryConfig.maxLines,
    },
  )
  const cacheDir = join(extraction.outDir, '.chunks')
  const cacheHits = chunks.filter((chunk) =>
    existsSync(getChunkCachePath(cacheDir, chunk.content)),
  )
  const missingChunkIndexes = chunks
    .map((chunk, index) => ({ chunk, index: index + 1 }))
    .filter(
      ({ chunk }) => !existsSync(getChunkCachePath(cacheDir, chunk.content)),
    )
    .map(({ index }) => index)

  console.log('OpenCode Summary Replay')
  console.log(`- Repo: ${extraction.repoPath}`)
  console.log(`- Project: ${extraction.project.id}`)
  console.log(`- Session: ${session.session.id}`)
  console.log(
    `- Title: ${session.session.title ?? session.session.slug ?? session.session.id}`,
  )
  console.log(`- Output dir: ${extraction.outDir}`)
  console.log(`- Cache dir: ${cacheDir}`)
  console.log(`- Messages: ${messages.length}`)
  console.log(`- Chunks planned: ${chunks.length}`)
  console.log(`- Cached chunks: ${cacheHits.length}/${chunks.length}`)
  console.log(`- Max chars: ${summaryConfig.maxChars}`)
  console.log(`- Max lines: ${summaryConfig.maxLines}`)
  console.log(`- Max tokens: ${summaryConfig.maxTokens}`)
  console.log(`- Timeout ms: ${summaryConfig.timeoutMs}`)
  console.log(`- Merge max est tokens: ${summaryConfig.mergeMaxEstTokens}`)

  if (!options.projectId) {
    console.log(
      '- Project selection: auto (pass --project if OpenCode has duplicate worktree entries)',
    )
  }

  if (!options.allowLiveChunks && missingChunkIndexes.length > 0) {
    throw new Error(
      `Missing cached chunk summaries for chunk indexes: ${missingChunkIndexes.join(', ')}. Re-run with --allow-live-chunks to regenerate them.`,
    )
  }

  const start = Date.now()
  const summary = await summarizeOpencodeSession(
    session,
    messages,
    summaryConfig,
    createLlmClient,
    cacheDir,
  )
  const elapsedMs = Date.now() - start

  const resultPath = join(cacheDir, `replay-result-${session.session.id}.json`)
  writeFileSync(resultPath, JSON.stringify(summary, null, 2) + '\n', 'utf-8')

  console.log(`- Replay result: ${resultPath}`)
  console.log(`- Replay time ms: ${elapsedMs}`)
}

function parseArgs(argv: string[]): CliOptions | null {
  const values = new Map<string, string>()
  const flags = new Set<string>()
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`)
    }
    const key = arg.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      flags.add(key)
      continue
    }
    values.set(key, next)
    index += 1
  }

  const repoPath = values.get('repo') ? resolve(values.get('repo')!) : null
  const sessionId = values.get('session')?.trim() ?? null
  if (!repoPath || !sessionId) {
    return null
  }

  return {
    repoPath,
    sessionId,
    dbPath: values.get('db') ? resolve(values.get('db')!) : null,
    outDir: values.get('out') ? resolve(values.get('out')!) : null,
    projectId: values.get('project')?.trim() ?? null,
    summaryModel: values.get('summary-model') ?? null,
    summaryApiKey: values.get('summary-api-key') ?? null,
    summaryApiUrl: values.get('summary-api-url') ?? null,
    summaryMaxTokens: parseOptionalNumber(values.get('summary-max-tokens')),
    summaryTimeoutMs: parseOptionalNumber(values.get('summary-timeout-ms')),
    summaryMaxChars: parseOptionalNumber(values.get('summary-max-chars')),
    summaryMaxLines: parseOptionalNumber(values.get('summary-max-lines')),
    summaryMergeMaxEstTokens: parseOptionalNumber(
      values.get('summary-merge-max-est-tokens'),
    ),
    allowLiveChunks: flags.has('allow-live-chunks'),
  }
}

function parseOptionalNumber(value: string | undefined): number | null {
  if (!value) {
    return null
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive number, got: ${value}`)
  }
  return Math.round(parsed)
}

function getChunkCachePath(cacheDir: string, content: string): string {
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16)
  return join(cacheDir, `chunk-${hash}.json`)
}

function printUsage(): void {
  console.log(`Usage:
  bun run scripts/debug-opencode-summary.ts \
    --repo /path/to/repo \
    --session ses_xxx \
    [--project opencode_project_id] \
    [--db /path/to/opencode.db] \
    [--out /path/to/.continuum/recall/opencode] \
    [--summary-timeout-ms 300000] \
    [--summary-max-tokens 4000] \
    [--summary-max-chars 5000] \
    [--summary-max-lines 200] \
    [--summary-merge-max-est-tokens 6000] \
    [--allow-live-chunks]

This replays one session through the same summary pipeline, reusing cached
chunk summaries from .continuum/recall/opencode/.chunks when available.
Without --allow-live-chunks it will fail if any chunk cache is missing.`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
