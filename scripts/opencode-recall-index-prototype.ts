import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

type ProjectRecord = {
  id: string
  worktree?: string
}

type SessionRecord = {
  id?: string
  slug?: string
  title?: string
  directory?: string
  time?: { created?: number; updated?: number }
}

type SessionIndexEntry = {
  key: string
  session_id: string
  project_id: string
  title: string | null
  slug: string | null
  directory: string | null
  created_at: string | null
  updated_at: string | null
  message_count: number
  part_count: number
  message_latest_mtime_ms: number | null
  part_latest_mtime_ms: number | null
  session_file: string
  message_dir: string | null
  session_mtime_ms: number | null
  fingerprint: string
}

type SourceIndex = {
  version: number
  generated_at: string
  storage_root: string
  data_root: string
  index_file: string
  filters: {
    project_id: string | null
    session_id: string | null
  }
  projects: Record<string, { id: string; worktree: string | null }>
  sessions: Record<string, SessionIndexEntry>
  stats: {
    project_count: number
    session_count: number
  }
}

type MessageStats = {
  count: number
  latestMtimeMs: number | null
  records: Array<{
    name: string
    id: string
    size: number
    mtimeMs: number
    partCount: number
    partLatestMtimeMs: number | null
    partSizeTotal: number
  }>
}

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

const toIso = (value?: number | null): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return new Date(value).toISOString()
}

const listJsonFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith('.json'))
}

const resolvePath = (value: string | null): string | null => {
  if (!value) return null
  return isAbsolute(value) ? value : resolve(process.cwd(), value)
}

const resolveDataRoot = (value: string | null): string => {
  if (value) return resolvePath(value) as string
  const dataHome = process.env.XDG_DATA_HOME
  return join(dataHome ?? join(homedir(), '.local', 'share'), 'continuum')
}

const resolveIndexFile = (value: string | null, dataRoot: string): string => {
  if (value) return resolvePath(value) as string
  return join(dataRoot, 'recall', 'opencode', 'source-index.json')
}

const collectMessageStats = (
  storageRoot: string,
  messageDir: string,
): MessageStats => {
  const files = listJsonFiles(messageDir).sort((a, b) => a.localeCompare(b))
  const records: MessageStats['records'] = []
  let latestMtimeMs: number | null = null

  for (const name of files) {
    const id = name.replace(/\.json$/, '')
    const stat = statSync(join(messageDir, name))
    const partStats = collectPartStats(storageRoot, id)
    records.push({
      name,
      id,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      partCount: partStats.count,
      partLatestMtimeMs: partStats.latestMtimeMs,
      partSizeTotal: partStats.sizeTotal,
    })
    if (latestMtimeMs === null || stat.mtimeMs > latestMtimeMs) {
      latestMtimeMs = stat.mtimeMs
    }
  }

  return { count: files.length, latestMtimeMs, records }
}

const collectPartStats = (storageRoot: string, messageId: string) => {
  const partDir = join(storageRoot, 'part', messageId)
  const files = listJsonFiles(partDir)
  let latestMtimeMs: number | null = null
  let sizeTotal = 0

  for (const name of files) {
    const stat = statSync(join(partDir, name))
    sizeTotal += stat.size
    if (latestMtimeMs === null || stat.mtimeMs > latestMtimeMs) {
      latestMtimeMs = stat.mtimeMs
    }
  }

  return {
    count: files.length,
    latestMtimeMs,
    sizeTotal,
  }
}

const buildFingerprint = (
  sessionRaw: string,
  messageStats: MessageStats,
): string => {
  const hash = createHash('sha256')
  hash.update(sessionRaw)
  hash.update(`|messages:${messageStats.count}`)
  for (const record of messageStats.records) {
    hash.update(`|msg:${record.name}:${record.size}:${record.mtimeMs}`)
    hash.update(
      `|parts:${record.id}:${record.partCount}:${record.partLatestMtimeMs ?? 'null'}:${record.partSizeTotal}`,
    )
  }
  return hash.digest('hex')
}

const run = () => {
  if (getFlag('--help')) {
    console.log('opencode-recall-index-prototype')
    console.log('')
    console.log(
      'Usage: bun run scripts/opencode-recall-index-prototype.ts [options]',
    )
    console.log('')
    console.log('Options:')
    console.log(
      '  --storage <path>    OpenCode storage root (default: ~/.local/share/opencode/storage)',
    )
    console.log(
      '  --data-root <path>  Continuum data root (default: $XDG_DATA_HOME/continuum)',
    )
    console.log(
      '  --index <path>      Output index file (default: <data-root>/recall/opencode/source-index.json)',
    )
    console.log('  --project <id>      Limit to a single project id')
    console.log('  --session <id>      Limit to a single session id')
    console.log('  --verbose           Print progress details')
    return
  }

  const storageRootArg = getArgValue('--storage')
  const dataRoot = resolveDataRoot(getArgValue('--data-root'))
  const indexFile = resolveIndexFile(getArgValue('--index'), dataRoot)
  const indexDir = resolve(join(indexFile, '..'))
  const projectFilter = getArgValue('--project')
  const sessionFilter = getArgValue('--session')
  const verbose = getFlag('--verbose')

  const dataHome = process.env.XDG_DATA_HOME
  const storageRoot = resolve(
    storageRootArg ??
      join(
        dataHome ?? join(homedir(), '.local', 'share'),
        'opencode',
        'storage',
      ),
  )

  if (!existsSync(storageRoot)) {
    throw new Error(`OpenCode storage not found: ${storageRoot}`)
  }

  const projectDir = join(storageRoot, 'project')
  const sessionRoot = join(storageRoot, 'session')
  if (!existsSync(projectDir) || !existsSync(sessionRoot)) {
    throw new Error('OpenCode storage missing project/session directories.')
  }

  const projectFiles = listJsonFiles(projectDir)
  const projects: Record<string, { id: string; worktree: string | null }> = {}
  for (const file of projectFiles) {
    const record = readJson<ProjectRecord>(join(projectDir, file))
    if (!record.id) continue
    projects[record.id] = {
      id: record.id,
      worktree: record.worktree ?? null,
    }
  }

  const sessionDirNames = readdirSync(sessionRoot).filter((name) => {
    const dirPath = join(sessionRoot, name)
    return existsSync(dirPath) && statSync(dirPath).isDirectory()
  })

  const entries: SessionIndexEntry[] = []
  for (const projectId of sessionDirNames) {
    if (projectFilter && projectId !== projectFilter) continue
    const sessionDir = join(sessionRoot, projectId)
    const sessionFiles = listJsonFiles(sessionDir)

    for (const file of sessionFiles) {
      const sessionPath = join(sessionDir, file)
      const raw = readFileSync(sessionPath, 'utf-8')
      const session = JSON.parse(raw) as SessionRecord
      const sessionId = session.id ?? file.replace(/\.json$/, '')
      if (sessionFilter && sessionId !== sessionFilter) continue
      const project = projects[projectId]
      const messageDir = join(storageRoot, 'message', sessionId)
      const messageStats = collectMessageStats(storageRoot, messageDir)

      let partCount = 0
      let partLatestMtimeMs: number | null = null
      for (const record of messageStats.records) {
        partCount += record.partCount
        if (
          record.partLatestMtimeMs !== null &&
          (partLatestMtimeMs === null ||
            record.partLatestMtimeMs > partLatestMtimeMs)
        ) {
          partLatestMtimeMs = record.partLatestMtimeMs
        }
      }

      const sessionStat = statSync(sessionPath)
      const fingerprint = buildFingerprint(raw, messageStats)
      const entry: SessionIndexEntry = {
        key: `${projectId}:${sessionId}`,
        session_id: sessionId,
        project_id: projectId,
        title: session.title ?? null,
        slug: session.slug ?? null,
        directory: session.directory ?? project?.worktree ?? null,
        created_at: toIso(session.time?.created),
        updated_at: toIso(session.time?.updated),
        message_count: messageStats.count,
        part_count: partCount,
        message_latest_mtime_ms: messageStats.latestMtimeMs,
        part_latest_mtime_ms: partLatestMtimeMs,
        session_file: sessionPath,
        message_dir: existsSync(messageDir) ? messageDir : null,
        session_mtime_ms: sessionStat.mtimeMs ?? null,
        fingerprint,
      }

      entries.push(entry)
      if (verbose) {
        console.log(`Indexed ${entry.key} (${entry.message_count} messages)`)
      }
    }
  }

  entries.sort((a, b) => {
    const left = a.created_at ?? ''
    const right = b.created_at ?? ''
    if (left !== right) return right.localeCompare(left)
    return a.key.localeCompare(b.key)
  })

  const sessions = Object.fromEntries(
    entries.map((entry) => [entry.key, entry]),
  )

  const index: SourceIndex = {
    version: 1,
    generated_at: new Date().toISOString(),
    storage_root: storageRoot,
    data_root: dataRoot,
    index_file: indexFile,
    filters: {
      project_id: projectFilter,
      session_id: sessionFilter,
    },
    projects,
    sessions,
    stats: {
      project_count: Object.keys(projects).length,
      session_count: entries.length,
    },
  }

  mkdirSync(indexDir, { recursive: true })
  writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`, 'utf-8')

  console.log(`Source index written: ${indexFile}`)
  console.log(
    `Sessions indexed: ${index.stats.session_count} (projects: ${index.stats.project_count})`,
  )
}

run()
