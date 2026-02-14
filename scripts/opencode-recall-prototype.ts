import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { resolve, join, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { serializeFrontmatter } from '../src/utils/frontmatter.ts'

type SessionRecord = {
  id: string
  slug?: string
  version?: string
  projectID?: string
  directory?: string
  title?: string
  parentID?: string
  time?: { created?: number; updated?: number }
}

type MessageRecord = {
  id: string
  sessionID: string
  role: string
  parentID?: string
  time?: { created?: number; completed?: number }
  summary?: { title?: string }
}

type PartRecord = {
  id: string
  sessionID?: string
  messageID: string
  type: string
  text?: string
  tool?: string
  time?: { start?: number; end?: number }
  state?: { status?: string; time?: { start?: number; end?: number } }
}

type ProjectRecord = {
  id: string
  worktree?: string
}

type NormalizedMessage = {
  id: string
  role: string
  createdAt: string | null
  completedAt: string | null
  text: string
}

type SummaryResult = {
  focus: string
  decisions: string[]
  discoveries: string[]
  patterns: string[]
  tasks: string[]
  files: string[]
  blockers: string[]
  open_questions: string[]
  next_steps: string[]
  confidence: 'low' | 'med' | 'high'
}

type SummaryClientConfig = {
  apiUrl: string
  apiKey: string
  model: string
  maxTokens: number
  timeoutMs: number
  verbose: boolean
}

type SummaryApiResult = {
  content: string
  finishReason?: string
}

type SummaryTokenState = {
  maxTokens: number
}

type MergePassReport = {
  pass: number
  mode: 'budgeted' | 'pair-fallback'
  group_est_tokens: number[]
  group_sizes: number[]
  merge_max_tokens_used: Array<number | null>
}

type MergeReport = {
  passes: MergePassReport[]
}

const SUMMARY_MAX_TOKENS_DEFAULT = 4000
const SUMMARY_MAX_TOKENS_STEP = 2000
const SUMMARY_MAX_TOKENS_CAP = 12000
const SUMMARY_REQUEST_TIMEOUT_MS_DEFAULT = 120000
const SUMMARY_SINGLE_PASS_MAX_EST_TOKENS_DEFAULT = 200000
const SUMMARY_MERGE_MAX_EST_TOKENS_DEFAULT = 12000
const SUMMARY_SECTION_CAPS = {
  decisions: 10,
  discoveries: 10,
  patterns: 10,
  tasks: 10,
} as const

const args = process.argv.slice(2)
const getFlag = (name: string) => args.includes(name)
const getArgValue = (name: string) => {
  const direct = args.find((arg) => arg.startsWith(`${name}=`))
  if (direct) return direct.split('=').slice(1).join('=')
  const index = args.findIndex((arg) => arg === name)
  if (index !== -1 && args[index + 1]) return args[index + 1]
  return null
}

const readJson = <T>(filePath: string): T =>
  JSON.parse(readFileSync(filePath, 'utf-8')) as T

const loadDotEnv = (filePath: string): void => {
  if (!existsSync(filePath)) return
  const raw = readFileSync(filePath, 'utf-8')
  const lines = raw.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) continue
    const key = trimmed.slice(0, separatorIndex).trim()
    let value = trimmed.slice(separatorIndex + 1).trim()
    if (!key || process.env[key] !== undefined) continue
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

const toIso = (value?: number | null): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return new Date(value).toISOString()
}

const formatTimestampForFilename = (value?: number | null): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown'
  return new Date(value).toISOString().replace(/:/g, '-').slice(0, 19)
}

const normalizeWhitespace = (value: string): string => {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const estimateTokens = (value: string): number => Math.ceil(value.length / 4)

const countLines = (value: string): number => {
  if (!value) return 0
  return value.split('\n').length
}

const renderNormalizedMessageBlock = (message: NormalizedMessage): string => {
  const roleLabel =
    message.role === 'assistant'
      ? 'Agent'
      : message.role === 'user'
        ? 'User'
        : message.role
  const timeLabel = message.createdAt ? ` (${message.createdAt})` : ''
  const body = message.text || '[no content captured]'
  return `### ${roleLabel}${timeLabel}\n\n${body}`
}

const buildNormalizedTranscript = (messages: NormalizedMessage[]): string => {
  return messages.map(renderNormalizedMessageBlock).join('\n\n')
}

const uniqueSorted = (items: string[]): string[] => {
  return Array.from(new Set(items)).sort((a, b) => a.localeCompare(b))
}

const sortByNumber = <T>(
  items: T[],
  getKey: (item: T) => number | null,
  direction: 'asc' | 'desc' = 'asc',
): T[] => {
  const multiplier = direction === 'asc' ? 1 : -1
  return items.sort((a, b) => {
    const left = getKey(a)
    const right = getKey(b)
    if (left === null && right === null) return 0
    if (left === null) return 1
    if (right === null) return -1
    return (left - right) * multiplier
  })
}

const resolveOutputDir = (repoPath: string, outArg: string | null) => {
  if (!outArg) return resolve(repoPath, '.continuum/recall/opencode')
  return isAbsolute(outArg) ? outArg : resolve(repoPath, outArg)
}

const buildMessageBlock = (
  message: MessageRecord,
  parts: PartRecord[],
): string => {
  const role = message.role?.toLowerCase() ?? 'unknown'
  const header =
    role === 'assistant'
      ? '## Agent'
      : role === 'user'
        ? '## User'
        : `## ${role.slice(0, 1).toUpperCase()}${role.slice(1)}`

  const segments: string[] = []
  for (const part of parts) {
    if (part.type === 'text' && typeof part.text === 'string') {
      segments.push(part.text)
      continue
    }
    if (part.type === 'tool') {
      const toolName = part.tool ?? 'unknown'
      const status = part.state?.status ? ` (${part.state.status})` : ''
      segments.push(`[Tool: ${toolName}${status}]`)
    }
  }

  let body = segments.join('\n').trim()
  if (!body && message.summary?.title) {
    body = message.summary.title.trim()
  }
  if (!body) {
    body = '[no content captured]'
  }
  return `${header}\n\n${body}`
}

const buildSessionDoc = (
  session: SessionRecord,
  project: ProjectRecord,
  messages: { message: MessageRecord; parts: PartRecord[] }[],
): string => {
  const createdAt = toIso(session.time?.created)
  const updatedAt = toIso(session.time?.updated)
  const frontmatter = serializeFrontmatter({
    source: 'opencode',
    session_id: session.id,
    project_id: project.id,
    directory: session.directory ?? project.worktree ?? null,
    slug: session.slug ?? null,
    title: session.title ?? null,
    created_at: createdAt,
    updated_at: updatedAt,
    message_count: messages.length,
  })

  const headerTitle = session.title?.trim() || session.slug || session.id
  const lines: string[] = []
  lines.push(frontmatter)
  lines.push('')
  lines.push(`# Session: ${headerTitle}`)
  lines.push('')

  for (const item of messages) {
    lines.push(buildMessageBlock(item.message, item.parts))
    lines.push('')
  }

  return lines.join('\n').trimEnd() + '\n'
}

const extractSignals = (messages: NormalizedMessage[]) => {
  const fileRegex =
    /\b[\w./-]+\.(ts|tsx|js|jsx|json|md|yaml|yml|sql|sh|go|py|rs)\b/g
  const taskRegex = /\btkt_[a-zA-Z0-9_-]+\b/g
  const files: string[] = []
  const tasks: string[] = []

  for (const message of messages) {
    const fileMatches = message.text.match(fileRegex)
    if (fileMatches) files.push(...fileMatches)
    const taskMatches = message.text.match(taskRegex)
    if (taskMatches) tasks.push(...taskMatches)
  }

  return {
    files: uniqueSorted(files),
    tasks: uniqueSorted(tasks),
  }
}

type SummaryChunkOptions = {
  maxChars: number
  maxLines: number
}

const chunkNormalizedMessages = (
  messages: NormalizedMessage[],
  options: SummaryChunkOptions,
): string[] => {
  const chunks: string[] = []
  const separator = '\n\n'
  const separatorChars = separator.length
  const separatorLines = 1

  let currentBlocks: string[] = []
  let currentChars = 0
  let currentLines = 0

  for (const message of messages) {
    const block = renderNormalizedMessageBlock(message)
    const blockChars = block.length
    const blockLines = countLines(block)
    const needsSeparator = currentBlocks.length > 0
    const nextChars =
      currentChars + blockChars + (needsSeparator ? separatorChars : 0)
    const nextLines =
      currentLines + blockLines + (needsSeparator ? separatorLines : 0)

    if (
      currentBlocks.length > 0 &&
      (nextChars > options.maxChars || nextLines > options.maxLines)
    ) {
      chunks.push(currentBlocks.join(separator))
      currentBlocks = []
      currentChars = 0
      currentLines = 0
    }

    const addSeparator = currentBlocks.length > 0
    currentBlocks.push(block)
    currentChars += blockChars + (addSeparator ? separatorChars : 0)
    currentLines += blockLines + (addSeparator ? separatorLines : 0)
  }

  if (currentBlocks.length > 0) {
    chunks.push(currentBlocks.join(separator))
  }

  return chunks
}

const SUMMARY_FIELDS = [
  'focus',
  'decisions',
  'discoveries',
  'patterns',
  'tasks',
  'files',
  'blockers',
  'open_questions',
  'next_steps',
  'confidence',
] as const

const SUMMARY_CHUNK_PROMPT = `You are summarizing a chunk of an OpenCode session transcript.

Return JSON only. Do not include markdown, backticks, or code fences.
Use only facts explicitly stated in the chunk. Do not infer or invent.

Field requirements:
- focus: one concise sentence describing the main intent of the chunk.
- decisions: only explicit decisions/commitments that were agreed, confirmed, or executed in the chunk. If it was merely proposed or suggested, do NOT list it here.
- discoveries: factual findings explicitly stated.
- patterns: recurring practices or conventions explicitly described.
- tasks: explicit action items or work described as done or to-do in the chunk; prefer durable tasks over transient steps.
- files: only file paths explicitly mentioned (no guesses).
- blockers: explicit blockers or constraints stated.
- open_questions: explicit questions or missing info requested.
- next_steps: explicit next actions stated (not speculative proposals).
- confidence: low | med | high (low if the chunk is sparse or ambiguous).

If a field is unknown or empty, use an empty string (focus only) or empty array.
Required JSON keys in this exact order: ${SUMMARY_FIELDS.join(', ')}.

**reminder**: Include a JSON object ONLY. Do not include markdown, backticks, or code fences.
`

const SUMMARY_MERGE_PROMPT = `You merge multiple chunk summaries into one session summary.

Return JSON only. Do not include markdown, backticks, or code fences.
Use only facts present in the provided chunk summaries. Do not add new facts.

Merge rules:
- De-duplicate list items; keep the most specific version.
- If items conflict, prefer the most recent or mark as open_questions.
- Do not reclassify proposals or suggestions as decisions.
- For Decisions, Discoveries, Patterns, and Tasks, keep at most 10 items each.
- Select the most impactful, durable items worth remembering later; drop transient execution details.

Field requirements match the chunk prompt.
Required JSON keys in this exact order: ${SUMMARY_FIELDS.join(', ')}.
confidence must be one of: low, med, high.
`

const extractJsonFromText = (content: string): string => {
  const trimmed = content.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Summary response is not valid JSON.')
  }
  return trimmed.slice(start, end + 1)
}

const ensureStringArray = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Summary field "${field}" must be an array.`)
  }
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new Error(`Summary field "${field}" must contain strings.`)
    }
  }
  return value
}

const normalizeSummary = (raw: unknown): SummaryResult => {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Summary response is not an object.')
  }
  const record = raw as Record<string, unknown>
  const focus = record.focus
  const confidence = record.confidence
  if (typeof focus !== 'string') {
    throw new Error('Summary field "focus" must be a string.')
  }
  if (confidence !== 'low' && confidence !== 'med' && confidence !== 'high') {
    throw new Error('Summary field "confidence" must be low, med, or high.')
  }

  return {
    focus,
    decisions: ensureStringArray(record.decisions, 'decisions'),
    discoveries: ensureStringArray(record.discoveries, 'discoveries'),
    patterns: ensureStringArray(record.patterns, 'patterns'),
    tasks: ensureStringArray(record.tasks, 'tasks'),
    files: ensureStringArray(record.files, 'files'),
    blockers: ensureStringArray(record.blockers, 'blockers'),
    open_questions: ensureStringArray(record.open_questions, 'open_questions'),
    next_steps: ensureStringArray(record.next_steps, 'next_steps'),
    confidence,
  }
}

const applySummaryCaps = (summary: SummaryResult): SummaryResult => {
  return {
    ...summary,
    decisions: summary.decisions.slice(0, SUMMARY_SECTION_CAPS.decisions),
    discoveries: summary.discoveries.slice(0, SUMMARY_SECTION_CAPS.discoveries),
    patterns: summary.patterns.slice(0, SUMMARY_SECTION_CAPS.patterns),
    tasks: summary.tasks.slice(0, SUMMARY_SECTION_CAPS.tasks),
  }
}

const normalizeFileEntry = (value: string): string =>
  value.replace(/[`\s]+/g, '').trim()

const filterFilesByTranscript = (
  files: string[],
  allowedFiles: Set<string>,
): string[] => {
  return files.filter((file) => allowedFiles.has(normalizeFileEntry(file)))
}

const TRANSIENT_ITEM_PATTERNS: RegExp[] = [
  /^run\b/i,
  /^re-?run\b/i,
  /^rerun\b/i,
  /^verify\b/i,
  /^check\b/i,
  /^inspect\b/i,
  /^debug\b/i,
  /^test\b/i,
  /^open\s+pr\b/i,
  /^commit\b/i,
  /^push\b/i,
  /\btypecheck\b/i,
  /\bbun\s+test\b/i,
  /\bsmoke\s+test\b/i,
  /\boutput\b/i,
  /\breport\b/i,
]

const isTransientItem = (value: string): boolean => {
  const trimmed = value.trim()
  if (!trimmed) return true
  return TRANSIENT_ITEM_PATTERNS.some((pattern) => pattern.test(trimmed))
}

const filterDurableItems = (items: string[]): string[] => {
  return items.filter((item) => !isTransientItem(item))
}

const applySummaryPostProcessing = (
  summary: SummaryResult,
  context: { allowedFiles: Set<string> },
): SummaryResult => {
  return {
    ...summary,
    files: filterFilesByTranscript(summary.files, context.allowedFiles),
    patterns: filterDurableItems(summary.patterns),
    tasks: filterDurableItems(summary.tasks),
  }
}

const parseSummaryResult = (content: string): SummaryResult => {
  const json = extractJsonFromText(content)
  const parsed = JSON.parse(json) as unknown
  return normalizeSummary(parsed)
}

type SummaryItem = {
  summary: SummaryResult
  estTokens: number
}

type MergeGroupResult = {
  item: SummaryItem
  maxTokensUsed: number | null
}

const estimateSummaryTokens = (summary: SummaryResult): number => {
  return estimateTokens(JSON.stringify(summary, null, 2))
}

const groupItemsByTokenBudget = (
  items: SummaryItem[],
  maxTokens: number,
): SummaryItem[][] => {
  const state = items.reduce(
    (acc, item) => {
      const nextTokens = acc.currentTokens + item.estTokens
      if (acc.current.length > 0 && nextTokens >= maxTokens) {
        return {
          groups: [...acc.groups, acc.current],
          current: [item],
          currentTokens: item.estTokens,
        }
      }
      return {
        groups: acc.groups,
        current: [...acc.current, item],
        currentTokens: nextTokens,
      }
    },
    {
      groups: [] as SummaryItem[][],
      current: [] as SummaryItem[],
      currentTokens: 0,
    },
  )

  return [...state.groups, state.current].filter((group) => group.length > 0)
}

const pairGroups = (items: SummaryItem[]): SummaryItem[][] => {
  return items.reduce<SummaryItem[][]>((groups, item, index) => {
    if (index % 2 === 0) {
      return [...groups, [item]]
    }
    const lastGroup = groups[groups.length - 1] ?? []
    return [...groups.slice(0, -1), [...lastGroup, item]]
  }, [])
}

const sumGroupTokens = (group: SummaryItem[]): number => {
  return group.reduce((total, item) => total + item.estTokens, 0)
}

const mergeSummaryGroup = async (
  config: SummaryClientConfig,
  sessionId: string,
  sessionStamp: string,
  group: SummaryItem[],
  context: string,
  debug: { enabled: boolean; dir: string },
  tokenState: SummaryTokenState,
): Promise<MergeGroupResult> => {
  if (group.length === 1) {
    return { item: group[0], maxTokensUsed: null }
  }

  const summaries = group.map((item) => item.summary)
  const rawMerged = await mergeSummariesContent(
    config,
    summaries,
    context,
    tokenState.maxTokens,
  )
  tokenState.maxTokens = Math.max(tokenState.maxTokens, rawMerged.maxTokens)
  const mergedContent = rawMerged.content
  if (rawMerged.finishReason && rawMerged.finishReason !== 'stop') {
    if (rawMerged.finishReason === 'length') {
      throw new Error(
        `Summary merge hit token limit (max_tokens=${rawMerged.maxTokens}, cap=${SUMMARY_MAX_TOKENS_CAP}). Increase --summary-max-tokens or raise SUMMARY_MAX_TOKENS_CAP.`,
      )
    }
    throw new Error(
      `Summary merge did not complete (finish_reason=${rawMerged.finishReason}).`,
    )
  }
  if (debug.enabled) {
    const debugPath = join(
      debug.dir,
      `OPENCODE-SUMMARY-RAW-${sessionStamp}-${sessionId}-${context.replace(/\s+/g, '-')}.txt`,
    )
    writeFileSync(debugPath, mergedContent, 'utf-8')
  }
  const summary = parseSummaryResult(mergedContent)
  return {
    item: { summary, estTokens: estimateSummaryTokens(summary) },
    maxTokensUsed: rawMerged.maxTokens,
  }
}

const mergeSummaryItems = async (
  config: SummaryClientConfig,
  sessionId: string,
  sessionStamp: string,
  initialItems: SummaryItem[],
  maxTokens: number,
  debug: { enabled: boolean; dir: string },
  tokenState: SummaryTokenState,
): Promise<{ summary: SummaryResult; report: MergeReport }> => {
  let pass = 1
  let items = initialItems
  const passes: MergePassReport[] = []

  while (items.length > 1) {
    const grouped = groupItemsByTokenBudget(items, maxTokens)
    const needsPairFallback =
      grouped.length === items.length && grouped.every((g) => g.length === 1)
    const groups = needsPairFallback ? pairGroups(items) : grouped
    const groupTokens = groups.map((group) => sumGroupTokens(group))
    const groupSizes = groups.map((group) => group.length)
    const mode: MergePassReport['mode'] = needsPairFallback
      ? 'pair-fallback'
      : 'budgeted'

    if (config.verbose) {
      const label = needsPairFallback ? 'pair-fallback' : 'budgeted'
      console.log(
        `[summary] merge pass ${pass} (${label}): groups=${groupTokens.join(', ')}`,
      )
    }

    const merged = await Promise.all(
      groups.map((group, index) =>
        mergeSummaryGroup(
          config,
          sessionId,
          sessionStamp,
          group,
          `merge-pass-${pass}-group-${index + 1}-of-${groups.length}`,
          debug,
          tokenState,
        ),
      ),
    )

    passes.push({
      pass,
      mode,
      group_est_tokens: groupTokens,
      group_sizes: groupSizes,
      merge_max_tokens_used: merged.map((result) => result.maxTokensUsed),
    })

    items = merged.map((result) => result.item)

    pass += 1
  }

  return { summary: items[0].summary, report: { passes } }
}

const callSummaryApi = async (
  config: SummaryClientConfig,
  messages: { role: 'system' | 'user'; content: string }[],
  maxTokens: number,
): Promise<SummaryApiResult> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  let response: Response
  try {
    response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `Summary API request timed out after ${config.timeoutMs}ms.`,
      )
    }
    throw error
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Summary API error (${response.status}): ${text}`)
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[]
  }
  const firstChoice = data.choices?.[0]
  const content = firstChoice?.message?.content
  const finishReason = firstChoice?.finish_reason
  if (!content) {
    throw new Error('Summary API response missing content.')
  }
  return { content, finishReason }
}

const callSummaryApiWithRetry = async (
  config: SummaryClientConfig,
  messages: { role: 'system' | 'user'; content: string }[],
  context: string,
  startMaxTokens: number = config.maxTokens,
): Promise<SummaryApiResult & { maxTokens: number }> => {
  let maxTokens = startMaxTokens
  let attempt = 1
  while (true) {
    if (config.verbose) {
      console.log(
        `[summary] ${context}: attempt ${attempt} max_tokens=${maxTokens}`,
      )
    }
    const result = await callSummaryApi(config, messages, maxTokens)
    if (result.finishReason !== 'length') {
      if (config.verbose) {
        console.log(
          `[summary] ${context}: finish_reason=${result.finishReason ?? 'unknown'}`,
        )
      }
      return { ...result, maxTokens }
    }
    const nextTokens = maxTokens + SUMMARY_MAX_TOKENS_STEP
    if (nextTokens > SUMMARY_MAX_TOKENS_CAP) {
      if (config.verbose) {
        console.log(
          `[summary] ${context}: hit token cap ${SUMMARY_MAX_TOKENS_CAP}`,
        )
      }
      return { ...result, maxTokens }
    }
    if (config.verbose) {
      console.log(
        `[summary] ${context}: finish_reason=length, retrying with max_tokens=${nextTokens}`,
      )
    }
    maxTokens = nextTokens
    attempt += 1
  }
}

const summarizeChunkContent = async (
  config: SummaryClientConfig,
  chunk: string,
  context: string,
  startMaxTokens: number,
): Promise<SummaryApiResult & { maxTokens: number }> => {
  return callSummaryApiWithRetry(
    config,
    [
      { role: 'system', content: SUMMARY_CHUNK_PROMPT },
      { role: 'user', content: `Transcript chunk:\n\n${chunk}` },
    ],
    context,
    startMaxTokens,
  )
}

const mergeSummariesContent = async (
  config: SummaryClientConfig,
  summaries: SummaryResult[],
  context: string,
  startMaxTokens: number,
): Promise<SummaryApiResult & { maxTokens: number }> => {
  const payload = JSON.stringify(summaries, null, 2)
  return callSummaryApiWithRetry(
    config,
    [
      { role: 'system', content: SUMMARY_MERGE_PROMPT },
      { role: 'user', content: `Chunk summaries (JSON array):\n\n${payload}` },
    ],
    context,
    startMaxTokens,
  )
}

const cleanListItem = (value: string): string => {
  return value.replace(/\s+/g, ' ').trim()
}

const renderSummaryList = (items: string[]): string[] => {
  if (items.length === 0) return ['- none']
  return items.map((item) => `- ${cleanListItem(item)}`)
}

const buildSummaryDoc = (
  session: SessionRecord,
  project: ProjectRecord,
  summary: SummaryResult,
  meta: {
    model: string
    chunkCount: number
    maxChars: number
    maxLines: number
  },
): string => {
  const createdAt = toIso(session.time?.created)
  const updatedAt = toIso(session.time?.updated)
  const frontmatter = serializeFrontmatter({
    source: 'opencode',
    session_id: session.id,
    project_id: project.id,
    directory: session.directory ?? project.worktree ?? null,
    slug: session.slug ?? null,
    title: session.title ?? null,
    created_at: createdAt,
    updated_at: updatedAt,
    summary_model: meta.model,
    summary_chunks: meta.chunkCount,
    summary_max_chars: meta.maxChars,
    summary_max_lines: meta.maxLines,
    summary_generated_at: new Date().toISOString(),
  })

  const headerTitle = session.title?.trim() || session.slug || session.id
  const lines: string[] = []
  lines.push(frontmatter)
  lines.push('')
  lines.push(`# Session Summary: ${headerTitle}`)
  lines.push('')
  lines.push('## Focus')
  lines.push('')
  lines.push(summary.focus.trim() ? summary.focus.trim() : 'none')
  lines.push('')
  lines.push('## Decisions')
  lines.push('')
  lines.push(...renderSummaryList(summary.decisions))
  lines.push('')
  lines.push('## Discoveries')
  lines.push('')
  lines.push(...renderSummaryList(summary.discoveries))
  lines.push('')
  lines.push('## Patterns')
  lines.push('')
  lines.push(...renderSummaryList(summary.patterns))
  lines.push('')
  lines.push('## Tasks')
  lines.push('')
  lines.push(...renderSummaryList(summary.tasks))
  lines.push('')
  lines.push('## Files')
  lines.push('')
  lines.push(...renderSummaryList(summary.files))
  lines.push('')
  lines.push('## Blockers')
  lines.push('')
  lines.push(...renderSummaryList(summary.blockers))
  lines.push('')
  lines.push('## Open Questions')
  lines.push('')
  lines.push(...renderSummaryList(summary.open_questions))
  lines.push('')
  lines.push('## Next Steps')
  lines.push('')
  lines.push(...renderSummaryList(summary.next_steps))
  lines.push('')
  lines.push(`## Confidence (${summary.confidence})`)
  lines.push('')
  lines.push('')
  return lines.join('\n').trimEnd() + '\n'
}

const buildNormalizedSessionDoc = (
  session: SessionRecord,
  project: ProjectRecord,
  messages: NormalizedMessage[],
): string => {
  const createdAt = toIso(session.time?.created)
  const updatedAt = toIso(session.time?.updated)
  const signals = extractSignals(messages)
  const frontmatter = serializeFrontmatter({
    source: 'opencode',
    session_id: session.id,
    project_id: project.id,
    directory: session.directory ?? project.worktree ?? null,
    slug: session.slug ?? null,
    title: session.title ?? null,
    created_at: createdAt,
    updated_at: updatedAt,
    message_count: messages.length,
    normalized: true,
  })

  const headerTitle = session.title?.trim() || session.slug || session.id
  const lines: string[] = []
  lines.push(frontmatter)
  lines.push('')
  lines.push(`# Session: ${headerTitle}`)
  lines.push('')
  lines.push('## Signals')
  lines.push('')
  lines.push(
    `- Files: ${signals.files.length > 0 ? signals.files.map((file) => `\`${file}\``).join(', ') : 'none'}`,
  )
  lines.push(
    `- Tasks: ${signals.tasks.length > 0 ? signals.tasks.join(', ') : 'none'}`,
  )
  lines.push('')
  lines.push('## Transcript')
  lines.push('')

  for (const message of messages) {
    lines.push(renderNormalizedMessageBlock(message))
    lines.push('')
  }

  return lines.join('\n').trimEnd() + '\n'
}

const buildSummaryInputDoc = (
  session: SessionRecord,
  project: ProjectRecord,
  chunk: string,
  options: {
    index: number
    total: number
    maxChars: number
    maxLines: number
  },
): string => {
  const createdAt = toIso(session.time?.created)
  const updatedAt = toIso(session.time?.updated)
  const frontmatter = serializeFrontmatter({
    source: 'opencode',
    session_id: session.id,
    project_id: project.id,
    directory: session.directory ?? project.worktree ?? null,
    slug: session.slug ?? null,
    title: session.title ?? null,
    created_at: createdAt,
    updated_at: updatedAt,
    chunk_index: options.index,
    chunk_count: options.total,
    chunk_max_chars: options.maxChars,
    chunk_max_lines: options.maxLines,
  })

  const headerTitle = session.title?.trim() || session.slug || session.id
  const lines: string[] = []
  lines.push(frontmatter)
  lines.push('')
  lines.push(`# Session: ${headerTitle}`)
  lines.push('')
  lines.push('## Transcript')
  lines.push('')
  lines.push(chunk)
  lines.push('')
  return lines.join('\n').trimEnd() + '\n'
}

const run = async () => {
  if (getFlag('--help')) {
    console.log('opencode-recall-prototype')
    console.log('')
    console.log('Usage: bun run scripts/opencode-recall-prototype.ts [options]')
    console.log('')
    console.log('Options:')
    console.log(
      '  --repo <path>     Repo path to match project worktree (default: cwd)',
    )
    console.log(
      '  --out <dir>       Output directory (default: .continuum/recall/opencode)',
    )
    console.log('  --limit <n>       Limit sessions processed (default: 5)')
    console.log('  --session <id>    Process a single session id')
    console.log(
      '  --storage <path>  OpenCode storage root (default: ~/.local/share/opencode/storage)',
    )
    console.log('  --summarize       Generate LLM summary docs')
    console.log(
      '  --summary-model <id>   LLM model id (or SUMMARY_MODEL env, default: kimi-k2.5)',
    )
    console.log(
      '  --summary-api-url <url>  LLM API URL (or SUMMARY_API_URL env)',
    )
    console.log(
      '  --summary-api-key <key>  LLM API key (or OPENCODE_ZEN_API_KEY / SUMMARY_API_KEY / OPENAI_API_KEY env)',
    )
    console.log(
      `  --summary-max-tokens <n> Max tokens per LLM call (default: ${SUMMARY_MAX_TOKENS_DEFAULT}; auto-retries +${SUMMARY_MAX_TOKENS_STEP} up to ${SUMMARY_MAX_TOKENS_CAP})`,
    )
    console.log(
      `  --summary-timeout-ms <n> Request timeout in ms (default: ${SUMMARY_REQUEST_TIMEOUT_MS_DEFAULT})`,
    )
    console.log(
      `  --summary-merge-max-est-tokens <n> Merge threshold for estimated tokens (default: ${SUMMARY_MERGE_MAX_EST_TOKENS_DEFAULT})`,
    )
    console.log(
      '  --summary-single-pass  Force single-pass summarization (full transcript)',
    )
    console.log('  --summary-chunked  Force chunk + merge summarization')
    console.log(
      '  Default: auto (single-pass when est tokens <= threshold; chunked otherwise)',
    )
    console.log(
      `  --summary-single-pass-max-est-tokens <n> Auto single-pass threshold (default: ${SUMMARY_SINGLE_PASS_MAX_EST_TOKENS_DEFAULT})`,
    )
    console.log(
      '  --summary-debug  Write raw LLM responses to _summary-debug (on errors and optionally for merges)',
    )
    console.log('  --summary-input  Write chunked summary inputs (debug only)')
    console.log('  --verbose        Verbose logging for summary requests')
    console.log(
      '  --summary-max-chars <n>  Max chars per summary chunk (default: 40000)',
    )
    console.log(
      '  --summary-max-lines <n>  Max lines per summary chunk (default: 1200)',
    )
    return
  }

  const repoPath = resolve(process.cwd(), getArgValue('--repo') ?? '.')
  loadDotEnv(resolve(repoPath, '.env'))
  const storageRoot = resolve(
    getArgValue('--storage') ??
      join(homedir(), '.local/share/opencode/storage'),
  )
  const outDir = resolveOutputDir(repoPath, getArgValue('--out'))
  const limitRaw = getArgValue('--limit')
  const limit = limitRaw ? Number(limitRaw) : 5
  const sessionFilter = getArgValue('--session')
  const summaryInput = getFlag('--summary-input')
  const summarize = getFlag('--summarize')
  const summaryDebug = getFlag('--summary-debug')
  const verbose = getFlag('--verbose')
  const summarySinglePassFlag = getFlag('--summary-single-pass')
  const summaryChunkedFlag = getFlag('--summary-chunked')
  const summaryAuto = summarize && !summarySinglePassFlag && !summaryChunkedFlag
  const summaryApiUrl =
    getArgValue('--summary-api-url') ??
    process.env.SUMMARY_API_URL ??
    'https://opencode.ai/zen/v1/chat/completions'
  const summaryApiKey =
    getArgValue('--summary-api-key') ??
    process.env.OPENCODE_ZEN_API_KEY ??
    process.env.SUMMARY_API_KEY ??
    process.env.OPENAI_API_KEY ??
    ''
  const summaryModel =
    getArgValue('--summary-model') ?? process.env.SUMMARY_MODEL ?? 'kimi-k2.5'
  const summaryMaxTokensRaw = getArgValue('--summary-max-tokens')
  const summaryMaxTokens = summaryMaxTokensRaw
    ? Number(summaryMaxTokensRaw)
    : SUMMARY_MAX_TOKENS_DEFAULT
  const summaryTimeoutRaw = getArgValue('--summary-timeout-ms')
  const summaryTimeoutMs = summaryTimeoutRaw
    ? Number(summaryTimeoutRaw)
    : SUMMARY_REQUEST_TIMEOUT_MS_DEFAULT
  const summaryMergeMaxTokensRaw = getArgValue('--summary-merge-max-est-tokens')
  const summaryMergeMaxTokens = summaryMergeMaxTokensRaw
    ? Number(summaryMergeMaxTokensRaw)
    : SUMMARY_MERGE_MAX_EST_TOKENS_DEFAULT
  const summarySinglePassMaxTokensRaw = getArgValue(
    '--summary-single-pass-max-est-tokens',
  )
  const summarySinglePassMaxTokens = summarySinglePassMaxTokensRaw
    ? Number(summarySinglePassMaxTokensRaw)
    : SUMMARY_SINGLE_PASS_MAX_EST_TOKENS_DEFAULT
  const summaryMaxCharsRaw = getArgValue('--summary-max-chars')
  const summaryMaxLinesRaw = getArgValue('--summary-max-lines')
  const summaryMaxChars = summaryMaxCharsRaw
    ? Number(summaryMaxCharsRaw)
    : 40000
  const summaryMaxLines = summaryMaxLinesRaw ? Number(summaryMaxLinesRaw) : 1200

  if (summarize) {
    if (!summaryApiKey) {
      throw new Error(
        'Missing summary API key. Use --summary-api-key or OPENCODE_ZEN_API_KEY/SUMMARY_API_KEY/OPENAI_API_KEY env.',
      )
    }
    if (!summaryModel) {
      throw new Error(
        'Missing summary model. Use --summary-model or SUMMARY_MODEL env.',
      )
    }
  }

  if (!existsSync(storageRoot)) {
    throw new Error(`OpenCode storage not found: ${storageRoot}`)
  }

  const projectDir = join(storageRoot, 'project')
  const projectFiles = existsSync(projectDir)
    ? readdirSync(projectDir).filter((name) => name.endsWith('.json'))
    : []
  const resolvedRepo = resolve(repoPath)

  let project: ProjectRecord | null = null
  for (const file of projectFiles) {
    const candidate = readJson<ProjectRecord>(join(projectDir, file))
    if (candidate.worktree && resolve(candidate.worktree) === resolvedRepo) {
      project = candidate
      break
    }
  }

  if (!project) {
    throw new Error(`No OpenCode project found for repo: ${resolvedRepo}`)
  }

  const summaryConfig: SummaryClientConfig | null = summarize
    ? {
        apiUrl: summaryApiUrl,
        apiKey: summaryApiKey,
        model: summaryModel,
        maxTokens: summaryMaxTokens,
        timeoutMs: summaryTimeoutMs,
        verbose,
      }
    : null

  const sessionDir = join(storageRoot, 'session', project.id)
  if (!existsSync(sessionDir)) {
    throw new Error(`Session directory not found: ${sessionDir}`)
  }

  let sessions = readdirSync(sessionDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJson<SessionRecord>(join(sessionDir, name)))

  if (sessionFilter) {
    sessions = sessions.filter((session) => session.id === sessionFilter)
  }

  sessions = sortByNumber(
    sessions,
    (session) =>
      typeof session.time?.created === 'number' ? session.time?.created : null,
    'desc',
  )

  const limitedSessions =
    Number.isFinite(limit) && limit > 0 ? sessions.slice(0, limit) : sessions

  if (sessionFilter && limitedSessions.length === 0) {
    throw new Error(
      `No sessions found for session id ${sessionFilter} under project ${project.id}.`,
    )
  }

  mkdirSync(outDir, { recursive: true })

  const outputPaths: string[] = []
  for (const session of limitedSessions) {
    const messageDir = join(storageRoot, 'message', session.id)
    const messageFiles = existsSync(messageDir)
      ? readdirSync(messageDir).filter((name) => name.endsWith('.json'))
      : []

    let messages = messageFiles.map((name) =>
      readJson<MessageRecord>(join(messageDir, name)),
    )
    messages = sortByNumber(
      messages,
      (message) =>
        typeof message.time?.created === 'number'
          ? message.time?.created
          : null,
      'asc',
    )

    const messageBlocks = messages.map((message) => {
      const partDir = join(storageRoot, 'part', message.id)
      const partFiles = existsSync(partDir)
        ? readdirSync(partDir).filter((name) => name.endsWith('.json'))
        : []
      let parts = partFiles.map((name) =>
        readJson<PartRecord>(join(partDir, name)),
      )

      parts = parts.sort((a, b) => {
        const left = a.time?.start ?? a.state?.time?.start
        const right = b.time?.start ?? b.state?.time?.start
        if (typeof left === 'number' && typeof right === 'number') {
          return left - right
        }
        if (typeof left === 'number') return -1
        if (typeof right === 'number') return 1
        return (a.id ?? '').localeCompare(b.id ?? '')
      })

      return { message, parts }
    })

    const normalizedMessages: NormalizedMessage[] = messageBlocks
      .map(({ message, parts }) => {
        const textParts = parts
          .filter(
            (part) => part.type === 'text' && typeof part.text === 'string',
          )
          .map((part) => part.text as string)
        const rawText = normalizeWhitespace(textParts.join('\n'))
        const text = rawText || message.summary?.title?.trim() || ''

        return {
          id: message.id,
          role: message.role ?? 'unknown',
          createdAt: toIso(message.time?.created),
          completedAt: toIso(message.time?.completed),
          text,
        }
      })
      .filter((message) => message.text.length > 0)

    const normalizedTranscript = buildNormalizedTranscript(normalizedMessages)
    const normalizedEstTokens = estimateTokens(normalizedTranscript)
    const summaryMode: 'single' | 'chunked' =
      summaryInput || summarize
        ? summaryChunkedFlag
          ? 'chunked'
          : summarySinglePassFlag
            ? 'single'
            : normalizedEstTokens <= summarySinglePassMaxTokens
              ? 'single'
              : 'chunked'
        : 'chunked'
    const buildSummaryChunks = (mode: 'single' | 'chunked') =>
      mode === 'single'
        ? [normalizedTranscript]
        : chunkNormalizedMessages(normalizedMessages, {
            maxChars: summaryMaxChars,
            maxLines: summaryMaxLines,
          })
    let summaryModeUsed = summaryMode
    let summaryChunks =
      summaryInput || summarize ? buildSummaryChunks(summaryMode) : []
    const allowedFiles = new Set(
      extractSignals(normalizedMessages).files.map(normalizeFileEntry),
    )

    const doc = buildSessionDoc(session, project, messageBlocks)
    const fileName = `OPENCODE-${formatTimestampForFilename(session.time?.created)}-${session.id}.md`
    const filePath = join(outDir, fileName)
    writeFileSync(filePath, doc, 'utf-8')
    outputPaths.push(filePath)

    const normalizedDoc = buildNormalizedSessionDoc(
      session,
      project,
      normalizedMessages,
    )
    const normalizedFileName = `OPENCODE-NORMALIZED-${formatTimestampForFilename(session.time?.created)}-${session.id}.md`
    const normalizedPath = join(outDir, normalizedFileName)
    writeFileSync(normalizedPath, normalizedDoc, 'utf-8')
    outputPaths.push(normalizedPath)

    if (summarize && summaryConfig) {
      const debugDir = join(outDir, '_summary-debug')
      const runSummary = async (mode: 'single' | 'chunked') => {
        summaryModeUsed = mode
        summaryChunks = buildSummaryChunks(mode)
        if (summaryChunks.length === 0) {
          console.log(`- Skipped summary (no content): ${session.id}`)
          return null
        }
        if (summaryDebug) {
          mkdirSync(debugDir, { recursive: true })
        }
        const chunkSummaries: SummaryResult[] = []
        const chunkTokenUsage: number[] = []
        const chunkEstimates = summaryChunks.map((chunk) =>
          estimateTokens(chunk),
        )
        const tokenState: SummaryTokenState = {
          maxTokens: summaryConfig.maxTokens,
        }
        for (const [index, chunk] of summaryChunks.entries()) {
          const raw = await summarizeChunkContent(
            summaryConfig,
            chunk,
            `chunk ${index + 1}/${summaryChunks.length}`,
            tokenState.maxTokens,
          )
          chunkTokenUsage[index] = raw.maxTokens
          tokenState.maxTokens = Math.max(tokenState.maxTokens, raw.maxTokens)
          const content = raw.content
          if (raw.finishReason && raw.finishReason !== 'stop') {
            if (raw.finishReason === 'length') {
              throw new Error(
                `Summary generation hit token limit (max_tokens=${raw.maxTokens}, cap=${SUMMARY_MAX_TOKENS_CAP}). Increase --summary-max-tokens or raise SUMMARY_MAX_TOKENS_CAP.`,
              )
            }
            throw new Error(
              `Summary generation did not complete (finish_reason=${raw.finishReason}).`,
            )
          }
          if (summaryDebug) {
            const part = String(index + 1).padStart(
              String(summaryChunks.length).length,
              '0',
            )
            const debugPath = join(
              debugDir,
              `OPENCODE-SUMMARY-RAW-${formatTimestampForFilename(session.time?.created)}-${session.id}-part-${part}.txt`,
            )
            writeFileSync(debugPath, content, 'utf-8')
            outputPaths.push(debugPath)
          }
          try {
            chunkSummaries.push(parseSummaryResult(content))
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error)
            throw new Error(
              `Summary parse failed for ${session.id} chunk ${index + 1}: ${message}`,
            )
          }
        }
        const sessionStamp = formatTimestampForFilename(session.time?.created)
        const debugConfig = { enabled: summaryDebug, dir: debugDir }
        const initialItems = chunkSummaries.map((summary, index) => ({
          summary,
          estTokens: chunkEstimates[index] ?? estimateSummaryTokens(summary),
        }))
        const mergeResult =
          chunkSummaries.length === 1
            ? { summary: chunkSummaries[0], report: { passes: [] } }
            : await mergeSummaryItems(
                summaryConfig,
                session.id,
                sessionStamp,
                initialItems,
                summaryMergeMaxTokens,
                debugConfig,
                tokenState,
              )
        const summary = applySummaryCaps(
          applySummaryPostProcessing(mergeResult.summary, {
            allowedFiles,
          }),
        )

        return {
          summary,
          mergeResult,
          tokenState,
          chunkTokenUsage,
        }
      }

      let summaryRun: Awaited<ReturnType<typeof runSummary>> | null = null
      try {
        summaryRun = await runSummary(summaryMode)
      } catch (error) {
        if (summaryAuto && summaryMode === 'single') {
          const message = error instanceof Error ? error.message : String(error)
          if (summaryConfig.verbose) {
            console.log(
              `[summary] single-pass failed for ${session.id}: ${message}. Falling back to chunked.`,
            )
          }
          summaryRun = await runSummary('chunked')
        } else {
          throw error
        }
      }

      if (summaryRun) {
        const summaryDoc = buildSummaryDoc(
          session,
          project,
          summaryRun.summary,
          {
            model: summaryConfig.model,
            chunkCount: summaryChunks.length,
            maxChars: summaryMaxChars,
            maxLines: summaryMaxLines,
          },
        )
        const summaryFileName = `OPENCODE-SUMMARY-${formatTimestampForFilename(session.time?.created)}-${session.id}.md`
        const summaryPath = join(outDir, summaryFileName)
        writeFileSync(summaryPath, summaryDoc, 'utf-8')
        outputPaths.push(summaryPath)

        const summaryMeta = {
          session_id: session.id,
          project_id: project.id,
          directory: session.directory ?? project.worktree ?? null,
          title: session.title ?? null,
          summary_model: summaryConfig.model,
          summary_generated_at: new Date().toISOString(),
          summary_chunks: summaryChunks.length,
          summary_mode: summaryModeUsed,
          summary_auto: summaryAuto,
          summary_single_pass_max_est_tokens: summarySinglePassMaxTokens,
          summary_single_pass_est_tokens: normalizedEstTokens,
          summary_caps: SUMMARY_SECTION_CAPS,
          summary_post_filters: {
            files: true,
            durable_patterns_tasks: true,
            allowed_files: allowedFiles.size,
          },
          summary_chunk_stats: summaryChunks.map((chunk, index) => ({
            index: index + 1,
            chars: chunk.length,
            lines: countLines(chunk),
            est_tokens: estimateTokens(chunk),
            max_tokens_used: summaryRun.chunkTokenUsage[index] ?? null,
          })),
          summary_merge_max_est_tokens: summaryMergeMaxTokens,
          summary_merge_passes: summaryRun.mergeResult.report.passes,
          summary_max_tokens_used: summaryRun.tokenState.maxTokens,
        }

        const metaFileName = `OPENCODE-SUMMARY-META-${formatTimestampForFilename(session.time?.created)}-${session.id}.json`
        const metaPath = join(outDir, metaFileName)
        writeFileSync(metaPath, JSON.stringify(summaryMeta, null, 2), 'utf-8')
        outputPaths.push(metaPath)

        if (summaryDebug) {
          const reportLines: string[] = []
          reportLines.push(`# Summary Quality Report: ${session.id}`)
          reportLines.push('')
          reportLines.push(`Model: ${summaryConfig.model}`)
          reportLines.push(`Chunks: ${summaryChunks.length}`)
          reportLines.push(`Mode: ${summaryModeUsed}`)
          reportLines.push(`Auto: ${summaryAuto ? 'true' : 'false'}`)
          reportLines.push(
            `Single-pass threshold: ${summarySinglePassMaxTokens} (est_tokens=${normalizedEstTokens})`,
          )
          reportLines.push(
            `Post filters: files=true, durable_patterns_tasks=true (allowed_files=${allowedFiles.size})`,
          )
          reportLines.push(
            `Merge threshold (est tokens): ${summaryMergeMaxTokens}`,
          )
          reportLines.push(
            `Max tokens used: ${summaryRun.tokenState.maxTokens}`,
          )
          reportLines.push('')
          reportLines.push('## Chunk Stats')
          reportLines.push('')
          summaryMeta.summary_chunk_stats.forEach((stat) => {
            reportLines.push(
              `- chunk ${stat.index}: chars=${stat.chars}, lines=${stat.lines}, est_tokens=${stat.est_tokens}, max_tokens_used=${stat.max_tokens_used ?? 'n/a'}`,
            )
          })
          reportLines.push('')
          reportLines.push('## Merge Passes')
          reportLines.push('')
          if (summaryRun.mergeResult.report.passes.length === 0) {
            reportLines.push('- none')
          } else {
            summaryRun.mergeResult.report.passes.forEach((pass) => {
              reportLines.push(
                `- pass ${pass.pass} (${pass.mode}): groups=${pass.group_est_tokens.join(', ')}`,
              )
              reportLines.push(
                `  max_tokens_used=${pass.merge_max_tokens_used.map((value) => value ?? 'n/a').join(', ')}`,
              )
            })
          }
          reportLines.push('')
          const reportPath = join(
            debugDir,
            `OPENCODE-SUMMARY-REPORT-${formatTimestampForFilename(session.time?.created)}-${session.id}.md`,
          )
          writeFileSync(reportPath, reportLines.join('\n'), 'utf-8')
          outputPaths.push(reportPath)
        }
      }
    }

    if (summaryInput) {
      const summaryDir = join(outDir, '_summary-input')
      mkdirSync(summaryDir, { recursive: true })
      const width = String(summaryChunks.length).length

      summaryChunks.forEach((chunk, index) => {
        const part = String(index + 1).padStart(width, '0')
        const summaryFileName = `OPENCODE-SUMMARY-INPUT-${formatTimestampForFilename(session.time?.created)}-${session.id}-part-${part}.md`
        const summaryPath = join(summaryDir, summaryFileName)
        const summaryDoc = buildSummaryInputDoc(session, project, chunk, {
          index: index + 1,
          total: summaryChunks.length,
          maxChars: summaryMaxChars,
          maxLines: summaryMaxLines,
        })
        writeFileSync(summaryPath, summaryDoc, 'utf-8')
        outputPaths.push(summaryPath)
      })
    }
  }

  console.log(`Project: ${project.id} (${resolvedRepo})`)
  console.log(`Sessions processed: ${limitedSessions.length}`)
  console.log(`Output dir: ${outDir}`)
  for (const filePath of outputPaths) {
    console.log(`- ${filePath}`)
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
