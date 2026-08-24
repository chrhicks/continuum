import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { main } from '../src/cli'
import { renderMemorySummary } from '../src/cli/commands/summary-memory'
import type { MemoryEvidence } from '../src/memory/application/query'

const roots: string[] = []
const originalArgv = process.argv
const originalCwd = process.cwd()

afterEach(() => {
  process.argv = originalArgv
  process.chdir(originalCwd)
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('canonical memory CLI', () => {
  test('migration dry-run leaves an empty workspace untouched', () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-migrate-dry-run-'))
    roots.push(root)
    const result = cli(root, ['memory', 'migrate', '--dry-run'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('No legacy artifacts found')
    expect(existsSync(join(root, '.continuum'))).toBe(false)
  })

  test('registers only the approved core surface', async () => {
    const result = spawnSync(
      'bun',
      ['run', 'bin/continuum', 'memory', '--help'],
      {
        cwd: originalCwd,
        encoding: 'utf8',
      },
    )
    const output = result.stdout
    for (const command of [
      'append',
      'consolidate',
      'search',
      'migrate',
      'recall',
    ])
      expect(output).toContain(command)
    for (const removed of [
      'session',
      'recover',
      'repair',
      'collect',
      'status',
      'list',
      'log',
    ])
      expect(output).not.toContain(`  ${removed}`)
  })

  test('summary and search work without Markdown projections', async () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-cutover-'))
    roots.push(root)
    process.chdir(root)
    await capture(['init'])
    await capture(['memory', 'append', 'agent', 'canonical sqlite evidence'])
    expect(await capture(['summary', '--no-tasks'])).toContain(
      'canonical sqlite evidence',
    )
    expect(await capture(['memory', 'search', 'sqlite'])).toContain(
      '[raw/journal]',
    )
  })

  test('summary renders complete memory without legacy storage markup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-summary-full-'))
    roots.push(root)
    process.chdir(root)
    await capture(['init'])
    const fullContent = `# Session: legacy\n\n${'complete memory detail '.repeat(20)}\n\n<a name="legacy-anchor"></a>\n\n**Link**: [Full details](MEMORY-2026-07-10.md#legacy-anchor)`
    await capture(['memory', 'append', 'agent', fullContent])

    const output = await capture(['summary', '--no-tasks'])

    expect(output).toContain('complete memory detail '.repeat(20).trim())
    expect(output).not.toContain('...')
    expect(output).not.toContain('legacy-anchor')
    expect(output).not.toContain('Full details')
  })

  test('summary shows all pending entries and three full consolidations', () => {
    const evidence: MemoryEvidence[] = [
      ...Array.from({ length: 4 }, (_, index) =>
        memoryEvidence('journal', `pending-${index + 1}`),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        memoryEvidence('consolidation', `consolidation-${index + 1}`),
      ),
    ]

    const output = renderMemorySummary(evidence, 3)

    expect(output).toContain('pending-4')
    expect(output).toContain('consolidation-1')
    expect(output).toContain('consolidation-3')
    expect(output).not.toContain('consolidation-4')
  })

  test('renders human and JSON append, consolidate, search, and summary contracts', () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-cli-golden-'))
    roots.push(root)
    expect(cli(root, ['init']).status).toBe(0)

    const appended = cli(root, ['memory', 'append', 'agent', 'golden needle'])
    expect(appended.stdout.trim()).toBe(
      'Appended agent entry to canonical memory.',
    )
    const appendedJson = JSON.parse(
      cli(root, ['--json', 'memory', 'append', 'user', 'filtered needle'])
        .stdout,
    )
    expect(appendedJson).toMatchObject({
      ok: true,
      data: {
        entry: { kind: 'user', content: 'filtered needle' },
        projection: { stale: false },
      },
    })

    const consolidated = cli(root, ['memory', 'consolidate'])
    expect(consolidated.stdout).toMatch(
      /^Consolidated sequences 1-2 \(2 entries\)\.\n$/,
    )
    const search = cli(root, [
      'memory',
      'search',
      'needle',
      '--source',
      'memory',
      '--tier',
      'MEMORY',
      '--limit',
      '1',
    ])
    expect(search.stdout).toContain('[derived/consolidation]')
    expect(search.stdout).not.toContain('[raw/')

    const searchJson = JSON.parse(
      cli(root, [
        '--json',
        'memory',
        'search',
        'needle',
        '--source',
        'memory',
        '--tier',
        'MEMORY',
      ]).stdout,
    )
    expect(searchJson.data[0]).toMatchObject({
      type: 'consolidation',
      provenance: 'derived',
      source: 'journal consolidation',
    })

    const summaryJson = JSON.parse(
      cli(root, ['--json', 'summary', '--no-tasks']).stdout,
    )
    expect(summaryJson.data.output).toContain('#### Derived consolidation')
    expect(summaryJson.data.output).toContain('filtered needle')
  })
})

function cli(root: string, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync('bun', ['run', 'bin/continuum', '--cwd', root, ...args], {
    cwd: originalCwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: join(root, 'home'),
      XDG_DATA_HOME: join(root, 'xdg-data'),
    },
  })
}

async function capture(args: string[]): Promise<string> {
  const lines: string[] = []
  const original = console.log
  console.log = (...values: unknown[]) => lines.push(values.join(' '))
  process.argv = ['bun', 'continuum', ...args]
  try {
    await main()
  } finally {
    console.log = original
  }
  return lines.join('\n')
}

function memoryEvidence(
  type: 'journal' | 'consolidation',
  content: string,
): MemoryEvidence {
  return {
    type,
    provenance: type === 'journal' ? 'raw' : 'derived',
    id: content,
    content,
    createdAt: '2026-07-11T00:00:00.000Z',
    source: type === 'journal' ? 'journal' : 'journal consolidation',
    tags: [],
    current: true,
  }
}
