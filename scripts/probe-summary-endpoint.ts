import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'

import { resolveLlmApiUrl, resolveLlmTransport } from '../src/llm/client'
import {
  RECALL_SUMMARY_JSON_SCHEMA,
  RECALL_SUMMARY_SCHEMA_NAME,
  type RecallSummaryResult,
  validateRecallSummaryInput,
} from '../src/memory/opencode/summary-schema'
import { resolveSummaryConfig } from '../src/memory/collectors/opencode-summary-config'
import { resolveOpencodeOutputDir } from '../src/memory/opencode/paths'

type CliOptions = {
  repoPath: string
  outDir: string | null
  summaryMaxTokens: number | null
  summaryTimeoutMs: number | null
  summaryMergeCounts: number[]
}

type ProbeResult = {
  name: string
  ok: boolean
  elapsedMs: number
  transport: 'chat_completions' | 'responses'
  resolvedApiUrl: string
  status?: number
  finishReason?: string | null
  responseLength?: number
  error?: string
  requestBytes: number
  parser?: 'none' | 'json' | 'summary'
}

const TINY_JSON_PROMPT = 'Return an object with ok=true.'

const TINY_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['ok'],
  properties: {
    ok: { type: 'boolean' },
  },
} as const

const SUMMARY_SHAPE_PROMPT =
  'Return an empty recall summary with an empty focus string, empty arrays for all list fields, and confidence set to low.'

const SUMMARY_MERGE_PROMPT = `You merge multiple chunk summaries into one session summary.

Use only facts present in the provided chunk summaries. Do not add new facts.

Merge rules:
- De-duplicate list items; keep the most specific version.
- If items conflict, prefer the most recent or surface the uncertainty in open_questions.
- Do not reclassify proposals or suggestions as decisions.
- Keep only durable, high-signal items worth remembering later.
- All fields must be populated, even when most arrays are empty.`

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
    summaryMaxTokens: options.summaryMaxTokens,
    summaryTimeoutMs: options.summaryTimeoutMs,
  })
  if (!summaryConfig) {
    throw new Error('Missing summary configuration for probe run.')
  }

  const outDir = resolveOpencodeOutputDir(options.repoPath, options.outDir)
  const chunkDir = join(outDir, '.chunks')
  mkdirSync(chunkDir, { recursive: true })
  const probeDir = join(chunkDir, 'endpoint-probe')
  mkdirSync(probeDir, { recursive: true })

  const chunkSummaries = loadChunkSummaries(chunkDir)
  const transport = resolveLlmTransport({
    apiUrl: summaryConfig.apiUrl,
    model: summaryConfig.model,
  })
  const resolvedApiUrl = resolveLlmApiUrl({
    apiUrl: summaryConfig.apiUrl,
    model: summaryConfig.model,
  })

  console.log('Endpoint Probe')
  console.log(`- Repo: ${options.repoPath}`)
  console.log(`- API URL: ${summaryConfig.apiUrl}`)
  console.log(`- Resolved API URL: ${resolvedApiUrl}`)
  console.log(`- Transport: ${transport}`)
  console.log(`- Model: ${summaryConfig.model}`)
  console.log(`- Timeout ms: ${summaryConfig.timeoutMs}`)
  console.log(`- Max tokens: ${summaryConfig.maxTokens}`)
  console.log(`- Cached chunk summaries: ${chunkSummaries.length}`)
  console.log(`- Probe dir: ${probeDir}`)

  if (chunkSummaries.length === 0) {
    console.log(
      '- Merge-like probes: skipped (no cached chunk summaries found)',
    )
  }

  const results: ProbeResult[] = []

  results.push(
    await runProbe({
      probeDir,
      name: 'tiny-text',
      apiUrl: summaryConfig.apiUrl,
      apiKey: summaryConfig.apiKey,
      model: summaryConfig.model,
      timeoutMs: summaryConfig.timeoutMs,
      maxTokens: 32,
      parser: 'none',
      messages: [
        { role: 'system', content: 'You are terse.' },
        { role: 'user', content: 'Reply with OK and nothing else.' },
      ],
    }),
  )

  results.push(
    await runProbe({
      probeDir,
      name: 'tiny-json',
      apiUrl: summaryConfig.apiUrl,
      apiKey: summaryConfig.apiKey,
      model: summaryConfig.model,
      timeoutMs: summaryConfig.timeoutMs,
      maxTokens: 32,
      parser: 'json',
      structuredOutput: {
        name: 'tiny_probe',
        schema: TINY_JSON_SCHEMA,
      },
      messages: [
        { role: 'system', content: 'Return a tiny JSON object.' },
        { role: 'user', content: TINY_JSON_PROMPT },
      ],
    }),
  )

  results.push(
    await runProbe({
      probeDir,
      name: 'summary-empty-shape',
      apiUrl: summaryConfig.apiUrl,
      apiKey: summaryConfig.apiKey,
      model: summaryConfig.model,
      timeoutMs: summaryConfig.timeoutMs,
      maxTokens: 256,
      parser: 'summary',
      structuredOutput: {
        name: RECALL_SUMMARY_SCHEMA_NAME,
        schema: RECALL_SUMMARY_JSON_SCHEMA,
      },
      messages: [
        { role: 'system', content: 'Return a recall summary.' },
        { role: 'user', content: SUMMARY_SHAPE_PROMPT },
      ],
    }),
  )

  for (const count of options.summaryMergeCounts) {
    if (count > chunkSummaries.length) {
      continue
    }
    const summaries = chunkSummaries.slice(0, count)
    results.push(
      await runProbe({
        probeDir,
        name: `merge-like-${count}`,
        apiUrl: summaryConfig.apiUrl,
        apiKey: summaryConfig.apiKey,
        model: summaryConfig.model,
        timeoutMs: summaryConfig.timeoutMs,
        maxTokens: summaryConfig.maxTokens,
        parser: 'summary',
        structuredOutput: {
          name: RECALL_SUMMARY_SCHEMA_NAME,
          schema: RECALL_SUMMARY_JSON_SCHEMA,
        },
        messages: [
          { role: 'system', content: SUMMARY_MERGE_PROMPT },
          {
            role: 'user',
            content: `Chunk summaries (JSON array):\n\n${JSON.stringify(summaries, null, 2)}`,
          },
        ],
      }),
    )
  }

  console.log('\nResults')
  for (const result of results) {
    const status = result.status ? ` status=${result.status}` : ''
    const finish = result.finishReason ? ` finish=${result.finishReason}` : ''
    const transport = ` transport=${result.transport}`
    const responseLength =
      typeof result.responseLength === 'number'
        ? ` responseBytes=${result.responseLength}`
        : ''
    const error = result.error ? ` error=${result.error}` : ''
    console.log(
      `- ${result.name}: ${result.ok ? 'ok' : 'fail'} elapsed=${result.elapsedMs}ms requestBytes=${result.requestBytes}${transport}${status}${finish}${responseLength}${error}`,
    )
  }
}

type RunProbeInput = {
  probeDir: string
  name: string
  apiUrl: string
  apiKey: string
  model: string
  timeoutMs: number
  maxTokens: number
  parser: 'none' | 'json' | 'summary'
  structuredOutput?: { name: string; schema: Record<string, unknown> }
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
}

async function runProbe(input: RunProbeInput): Promise<ProbeResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs)
  const transport = resolveLlmTransport({
    apiUrl: input.apiUrl,
    model: input.model,
  })
  const resolvedApiUrl = resolveLlmApiUrl({
    apiUrl: input.apiUrl,
    model: input.model,
  })
  const body =
    transport === 'responses'
      ? {
          model: input.model,
          input: mapMessagesToResponsesInput(input.messages),
          temperature: 0.2,
          max_output_tokens: input.maxTokens,
          text: input.structuredOutput
            ? {
                format: {
                  type: 'json_schema',
                  name: input.structuredOutput.name,
                  strict: true,
                  schema: input.structuredOutput.schema,
                },
              }
            : undefined,
        }
      : {
          model: input.model,
          messages: input.messages,
          temperature: 0.2,
          max_tokens: input.maxTokens,
          response_format: input.structuredOutput
            ? {
                type: 'json_schema',
                json_schema: {
                  name: input.structuredOutput.name,
                  strict: true,
                  schema: input.structuredOutput.schema,
                },
              }
            : undefined,
        }
  const requestBytes = Buffer.byteLength(JSON.stringify(body), 'utf8')
  const startedAt = Date.now()
  const requestPath = join(input.probeDir, `${input.name}-request.json`)
  writeFileSync(
    requestPath,
    JSON.stringify(
      {
        apiUrl: input.apiUrl,
        resolvedApiUrl,
        transport,
        model: input.model,
        timeoutMs: input.timeoutMs,
        maxTokens: input.maxTokens,
        requestBytes,
        body,
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  )

  try {
    const response = await fetch(resolvedApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const elapsedMs = Date.now() - startedAt
    const raw = await response.text()
    const responsePath = join(input.probeDir, `${input.name}-response.json`)
    writeFileSync(
      responsePath,
      JSON.stringify(
        {
          status: response.status,
          statusText: response.statusText,
          elapsedMs,
          headers: Object.fromEntries(response.headers.entries()),
          raw,
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    )

    if (!response.ok) {
      return {
        name: input.name,
        ok: false,
        elapsedMs,
        transport,
        resolvedApiUrl,
        status: response.status,
        requestBytes,
        responseLength: Buffer.byteLength(raw, 'utf8'),
        parser: input.parser,
        error: `HTTP ${response.status}`,
      }
    }

    let finishReason: string | null = null
    let content = raw
    const parsed = tryParseJson(raw)
    if (parsed) {
      if (transport === 'responses') {
        const result = extractResponsesResult(parsed)
        finishReason = result.finishReason
        content = result.content
      } else {
        const result = extractChatCompletionResult(parsed)
        finishReason = result.finishReason
        content = result.content
      }
    }

    validateContent(input.parser, content)
    return {
      name: input.name,
      ok: true,
      elapsedMs,
      transport,
      resolvedApiUrl,
      status: response.status,
      finishReason,
      requestBytes,
      responseLength: Buffer.byteLength(content || raw, 'utf8'),
      parser: input.parser,
    }
  } catch (error) {
    const elapsedMs = Date.now() - startedAt
    const message = error instanceof Error ? error.message : String(error)
    const errorPath = join(input.probeDir, `${input.name}-error.json`)
    writeFileSync(
      errorPath,
      JSON.stringify({ elapsedMs, error: message }, null, 2) + '\n',
      'utf-8',
    )
    return {
      name: input.name,
      ok: false,
      elapsedMs,
      transport,
      resolvedApiUrl,
      requestBytes,
      parser: input.parser,
      error: message,
    }
  } finally {
    clearTimeout(timer)
  }
}

function validateContent(
  parser: 'none' | 'json' | 'summary',
  content: string,
): void {
  if (parser === 'none') {
    return
  }
  if (parser === 'json') {
    JSON.parse(content)
    return
  }
  validateRecallSummaryInput(JSON.parse(content) as unknown)
}

function loadChunkSummaries(chunkDir: string): RecallSummaryResult[] {
  if (!existsSync(chunkDir)) {
    return []
  }
  return readdirSync(chunkDir)
    .filter((entry) => /^chunk-[0-9a-f]{16}\.json$/.test(entry))
    .sort()
    .map((entry) => {
      const path = join(chunkDir, entry)
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
      return validateRecallSummaryInput(parsed)
    })
}

function tryParseJson(content: string): unknown | null {
  try {
    return JSON.parse(content) as unknown
  } catch {
    return null
  }
}

function extractChatCompletionResult(data: unknown): {
  finishReason: string | null
  content: string
} {
  const parsed = data as {
    choices?: { message?: { content?: string }; finish_reason?: string }[]
  }
  const choice = parsed.choices?.[0]
  return {
    finishReason: choice?.finish_reason ?? null,
    content: choice?.message?.content ?? '',
  }
}

function extractResponsesResult(data: unknown): {
  finishReason: string | null
  content: string
} {
  const parsed = data as {
    status?: string | null
    output_text?: string | null
    incomplete_details?: { reason?: string | null } | null
    output?: Array<{
      type?: string | null
      content?: Array<{
        type?: string | null
        text?: string | null
      }> | null
    }> | null
  }

  const content =
    parsed.output_text ??
    (parsed.output ?? [])
      .filter((item) => item?.type === 'message')
      .flatMap((item) => item.content ?? [])
      .filter(
        (part) => part?.type === 'output_text' && typeof part.text === 'string',
      )
      .map((part) => part.text)
      .join('')

  const reason = parsed.incomplete_details?.reason ?? null
  return {
    finishReason:
      reason === 'max_output_tokens'
        ? 'length'
        : reason === 'content_filter'
          ? 'content_filter'
          : parsed.status === 'completed'
            ? 'stop'
            : null,
    content,
  }
}

function mapMessagesToResponsesInput(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
): Array<{ role: 'developer' | 'user' | 'assistant'; content: string }> {
  return messages.map((message) => ({
    role: message.role === 'system' ? 'developer' : message.role,
    content: message.content,
  }))
}

function parseArgs(argv: string[]): CliOptions | null {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`)
    }
    const key = arg.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for --${key}`)
    }
    values.set(key, next)
    index += 1
  }
  const repoPath = values.get('repo') ? resolve(values.get('repo')!) : null
  if (!repoPath) {
    return null
  }
  return {
    repoPath,
    outDir: values.get('out') ? resolve(values.get('out')!) : null,
    summaryMaxTokens: parseOptionalNumber(values.get('summary-max-tokens')),
    summaryTimeoutMs: parseOptionalNumber(values.get('summary-timeout-ms')),
    summaryMergeCounts: parseCounts(values.get('merge-counts') ?? '1,2,4,6'),
  }
}

function parseOptionalNumber(value: string | undefined): number | null {
  if (!value) {
    return null
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected positive number, got: ${value}`)
  }
  return Math.round(parsed)
}

function parseCounts(value: string): number[] {
  return value
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
    .map((entry) => Math.round(entry))
}

function printUsage(): void {
  console.log(`Usage:
  bun run scripts/probe-summary-endpoint.ts \
    --repo /path/to/repo \
    [--out /path/to/.continuum/recall/opencode] \
    [--summary-timeout-ms 300000] \
    [--summary-max-tokens 4000] \
    [--merge-counts 1,2,4,6]

This probes the configured summary endpoint using the same API URL, model,
key, timeout, transport auto-routing, and request shape as the memory
summarizer. It starts with tiny requests and then builds up to merge-like
payloads using cached chunk summaries.
Artifacts are written under .continuum/recall/opencode/.chunks/endpoint-probe/.`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
