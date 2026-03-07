import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { main } from '../src/cli'
import { readInput } from '../src/cli/io'
import continuum from '../src/sdk'
import { getCurrentSessionPath, startSession } from '../src/memory/session'

async function withTempCwd(run: () => Promise<void> | void): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'continuum-cli-'))
  const previous = process.cwd()
  const env = snapshotConsolidationEnv()
  try {
    clearConsolidationEnv()
    process.chdir(root)
    await run()
  } finally {
    restoreConsolidationEnv(env)
    process.chdir(previous)
    rmSync(root, { recursive: true, force: true })
  }
}

function snapshotConsolidationEnv(): Record<string, string | undefined> {
  return {
    OPENCODE_ZEN_API_KEY: process.env.OPENCODE_ZEN_API_KEY,
    CONSOLIDATION_API_KEY: process.env.CONSOLIDATION_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    SUMMARY_MODEL: process.env.SUMMARY_MODEL,
    CONSOLIDATION_MODEL: process.env.CONSOLIDATION_MODEL,
    SUMMARY_API_URL: process.env.SUMMARY_API_URL,
  }
}

function clearConsolidationEnv(): void {
  delete process.env.OPENCODE_ZEN_API_KEY
  delete process.env.CONSOLIDATION_API_KEY
  delete process.env.OPENAI_API_KEY
  delete process.env.SUMMARY_MODEL
  delete process.env.CONSOLIDATION_MODEL
  delete process.env.SUMMARY_API_URL
}

function restoreConsolidationEnv(
  env: Record<string, string | undefined>,
): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key]
      continue
    }
    process.env[key] = value
  }
}

async function withCapturedLogs(run: () => Promise<void>): Promise<string[]> {
  const logs: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(' '))
  }
  try {
    await run()
  } finally {
    console.log = original
  }
  return logs
}

const RECALL_SUMMARY_CONTENT = [
  '---',
  'source: opencode',
  'session_id: ses_test_cli',
  'project_id: proj_test',
  'directory: /tmp/project',
  'slug: test-session',
  'title: Test Session',
  'created_at: 2026-02-10T10:00:00.000Z',
  'updated_at: 2026-02-10T10:30:00.000Z',
  'summary_model: test',
  'summary_chunks: 1',
  'summary_max_chars: 1000',
  'summary_max_lines: 200',
  'summary_generated_at: 2026-02-10T10:31:00.000Z',
  'summary_keyword_total: 0',
  '---',
  '',
  '# Session Summary: Test Session',
  '',
  '## Focus',
  '',
  'Test recall import CLI.',
  '',
  '## Decisions',
  '',
  '- None',
  '',
  '## Discoveries',
  '',
  '- CLI uses summary dir.',
  '',
  '## Patterns',
  '',
  '- none',
  '',
  '## Tasks',
  '',
  '- tkt_cli',
  '',
  '## Files',
  '',
  '- src/memory/recall-import.ts',
  '',
  '## Keywords',
  '',
  '- commands: `memory recall import`',
  '',
  '## Blockers',
  '',
  '- none',
  '',
  '## Open Questions',
  '',
  '- none',
  '',
  '## Next Steps',
  '',
  '- write tests',
  '',
  '## Confidence (0.72)',
  '',
].join('\n')

describe('memory search CLI', () => {
  test('includes recall summaries by default', async () => {
    await withTempCwd(async () => {
      const recallDir = join(process.cwd(), '.continuum', 'recall', 'opencode')
      mkdirSync(recallDir, { recursive: true })
      writeFileSync(
        join(recallDir, 'OPENCODE-SUMMARY-2026-02-10T10-00-00-ses_alpha.md'),
        [
          '---',
          'session_id: ses_alpha',
          'title: Alpha Session',
          'created_at: 2026-02-10T10:00:00.000Z',
          '---',
          '',
          '# Session Summary: Alpha Session',
          '',
          '## Focus',
          '',
          'alpha recall focus',
          '',
        ].join('\n'),
        'utf-8',
      )

      const originalArgv = process.argv
      process.argv = ['node', 'continuum', 'memory', 'search', 'alpha']

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        expect(logs.some((line) => line.includes('[recall'))).toBe(true)
        expect(logs.some((line) => line.includes('ses_alpha'))).toBe(true)
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('accepts --tier=VALUE syntax', async () => {
    await withTempCwd(async () => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })
      writeFileSync(
        join(memoryDir, 'NOW-2026-02-02T16-10-00.md'),
        'hello world',
        'utf-8',
      )

      const originalArgv = process.argv
      process.argv = [
        'node',
        'continuum',
        'memory',
        'search',
        'hello',
        '--tier=NOW',
      ]

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        expect(logs.some((line) => line.includes('Found'))).toBe(true)
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('filters results with --tags', async () => {
    await withTempCwd(async () => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })
      writeFileSync(
        join(memoryDir, 'NOW-2026-02-02T16-10-00-alpha.md'),
        '---\ntags: [alpha]\n---\nhello alpha\n',
        'utf-8',
      )
      writeFileSync(
        join(memoryDir, 'NOW-2026-02-02T16-10-00-beta.md'),
        '---\ntags: [beta]\n---\nhello beta\n',
        'utf-8',
      )

      const originalArgv = process.argv
      process.argv = [
        'node',
        'continuum',
        'memory',
        'search',
        'hello',
        '--tags',
        'alpha',
      ]

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        expect(
          logs.some((line) =>
            line.includes('NOW-2026-02-02T16-10-00-alpha.md'),
          ),
        ).toBe(true)
        expect(
          logs.some((line) => line.includes('NOW-2026-02-02T16-10-00-beta.md')),
        ).toBe(false)
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('filters results with --after', async () => {
    await withTempCwd(async () => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })
      writeFileSync(
        join(memoryDir, 'NOW-2026-02-01T16-10-00-old.md'),
        [
          '---',
          'timestamp_start: 2026-02-01T16:10:00.000Z',
          '---',
          'hello old',
          '',
        ].join('\n'),
        'utf-8',
      )
      writeFileSync(
        join(memoryDir, 'NOW-2026-02-03T16-10-00-new.md'),
        [
          '---',
          'timestamp_start: 2026-02-03T16:10:00.000Z',
          '---',
          'hello new',
          '',
        ].join('\n'),
        'utf-8',
      )

      const originalArgv = process.argv
      process.argv = [
        'node',
        'continuum',
        'memory',
        'search',
        'hello',
        '--after',
        '2026-02-02T00:00:00.000Z',
      ]

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        expect(logs.some((line) => line.includes('old.md'))).toBe(false)
        expect(logs.some((line) => line.includes('new.md'))).toBe(true)
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('rejects invalid --after value', async () => {
    await withTempCwd(async () => {
      const originalArgv = process.argv
      process.argv = [
        'node',
        'continuum',
        'memory',
        'search',
        'hello',
        '--after',
        'not-a-date',
      ]

      try {
        await expect(main()).rejects.toThrow('Invalid --after date')
      } finally {
        process.argv = originalArgv
      }
    })
  })
})

describe('memory collect CLI', () => {
  test('collects task source into consolidated memory', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()
      const task = await continuum.task.create({
        title: 'Collect task source via CLI',
        type: 'feature',
        intent: 'Make task history searchable through memory search.',
        description: 'Touch src/memory/collectors/task.ts',
        plan: '1. Add task collector\n2. Validate search',
      })
      await continuum.task.notes.add(task.id, {
        kind: 'discovery',
        content: 'CLI collection should consolidate task history directly.',
        source: 'agent',
      })

      const originalArgv = process.argv
      process.argv = [
        'node',
        'continuum',
        'memory',
        'collect',
        '--source',
        'task',
      ]

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        const output = logs.join('\n')
        expect(output).toContain('Task records emitted: 1')
        expect(output).toContain('Skipped unchanged: 0')

        const memoryFile = readFileSync(
          join(
            process.cwd(),
            '.continuum',
            'memory',
            `MEMORY-${new Date().toISOString().slice(0, 10)}.md`,
          ),
          'utf-8',
        )
        expect(memoryFile).toContain(task.id)
        expect(memoryFile).toContain(
          'Make task history searchable through memory search.',
        )
      } finally {
        process.argv = originalArgv
      }
    })
  })
})

describe('memory recall CLI', () => {
  test('prints dry-run summary for recall import', async () => {
    await withTempCwd(async () => {
      const recallDir = join(process.cwd(), '.continuum', 'recall', 'opencode')
      mkdirSync(recallDir, { recursive: true })
      writeFileSync(
        join(recallDir, 'OPENCODE-SUMMARY-2026-02-10T10-00-00-ses_test_cli.md'),
        RECALL_SUMMARY_CONTENT,
        'utf-8',
      )

      const originalArgv = process.argv
      process.argv = [
        'node',
        'continuum',
        'memory',
        'recall',
        'import',
        '--dry-run',
      ]

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        const output = logs.join('\n')
        expect(output).toContain('Recall import (dry run):')
        expect(output).toContain('Summaries: 1')
        expect(output).toContain('Imported: 0')
        expect(output).toContain('Skipped (existing): 0')
        expect(output).toContain('Skipped (invalid): 0')
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('reports when no recall summaries exist', async () => {
    await withTempCwd(async () => {
      const recallDir = join(process.cwd(), '.continuum', 'recall', 'opencode')
      mkdirSync(recallDir, { recursive: true })

      const originalArgv = process.argv
      process.argv = ['node', 'continuum', 'memory', 'recall', 'import']

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        const output = logs.join('\n')
        expect(output).toContain(
          `No opencode recall summaries found in ${recallDir}.`,
        )
      } finally {
        process.argv = originalArgv
      }
    })
  })
})

describe('task CLI', () => {
  test('task create auto-initializes when missing', async () => {
    await withTempCwd(async () => {
      const originalArgv = process.argv
      process.argv = [
        'node',
        'continuum',
        'task',
        'create',
        '--title',
        'First task',
        '--type',
        'feature',
      ]

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        const output = logs.join('\n')
        const dbPath = join(process.cwd(), '.continuum', 'continuum.db')
        expect(existsSync(dbPath)).toBe(true)
        expect(
          logs.some((line) => line.includes('Initialized continuum')),
        ).toBe(true)
        expect(logs.some((line) => line.includes('created task'))).toBe(true)
        expect(output).toContain('Next steps:')
        expect(output).toContain('continuum task steps add')
        expect(output).toContain('continuum task note add')
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('continuum init initializes database', async () => {
    await withTempCwd(async () => {
      const originalArgv = process.argv
      process.argv = ['node', 'continuum', 'init']

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        const dbPath = join(process.cwd(), '.continuum', 'continuum.db')
        expect(existsSync(dbPath)).toBe(true)
        expect(
          logs.some((line) =>
            line.includes('Initialized continuum in current directory.'),
          ),
        ).toBe(true)
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('task list excludes cancelled and completed tasks by default', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()
      const openTask = await continuum.task.create({
        title: 'Open task',
        type: 'feature',
        description: 'Should appear in list.',
      })
      const cancelledTask = await continuum.task.create({
        title: 'Cancelled task',
        type: 'feature',
        status: 'cancelled',
        description: 'Should be hidden by default.',
      })
      const completedTask = await continuum.task.create({
        title: 'Completed task',
        type: 'feature',
        status: 'completed',
        description: 'Should be hidden by default.',
      })

      const originalArgv = process.argv
      process.argv = ['node', 'continuum', 'task', 'list']

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        const output = logs.join('\n')
        expect(output).toContain(openTask.id)
        expect(output).not.toContain(cancelledTask.id)
        expect(output).not.toContain(completedTask.id)
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('task list --status cancelled includes cancelled tasks', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()
      const openTask = await continuum.task.create({
        title: 'Open task',
        type: 'feature',
        description: 'Should be filtered out.',
      })
      const cancelledTask = await continuum.task.create({
        title: 'Cancelled task',
        type: 'feature',
        status: 'cancelled',
        description: 'Should appear when filtered.',
      })

      const originalArgv = process.argv
      process.argv = [
        'node',
        'continuum',
        'task',
        'list',
        '--status',
        'cancelled',
      ]

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        const output = logs.join('\n')
        expect(output).toContain(cancelledTask.id)
        expect(output).not.toContain(openTask.id)
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('task list --status completed includes completed tasks', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()
      const openTask = await continuum.task.create({
        title: 'Open task',
        type: 'feature',
        description: 'Should be filtered out.',
      })
      const completedTask = await continuum.task.create({
        title: 'Completed task',
        type: 'feature',
        status: 'completed',
        description: 'Should appear when filtered.',
      })

      const originalArgv = process.argv
      process.argv = [
        'node',
        'continuum',
        'task',
        'list',
        '--status',
        'completed',
      ]

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        const output = logs.join('\n')
        expect(output).toContain(completedTask.id)
        expect(output).not.toContain(openTask.id)
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('task step alias works', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()
      const task = await continuum.task.create({
        title: 'Alias steps',
        type: 'feature',
        description: 'Verify singular step alias.',
      })

      const originalArgv = process.argv
      process.argv = ['node', 'continuum', 'task', 'step', 'list', task.id]

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        expect(logs.some((line) => line.includes('No steps found.'))).toBe(true)
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('task steps template prints JSON', async () => {
    await withTempCwd(async () => {
      const originalArgv = process.argv
      process.argv = ['node', 'continuum', 'task', 'steps', 'template']

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        const output = logs.join('\n')
        expect(output).toContain('"title"')
        expect(output).toContain('"description"')
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('task steps add prints next-step hints', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()
      const task = await continuum.task.create({
        title: 'Steps hints',
        type: 'feature',
        description: 'Ensure next-step hints are printed.',
      })
      const stepsPath = join(process.cwd(), 'steps.json')
      writeFileSync(
        stepsPath,
        JSON.stringify(
          [{ title: 'Step 1', description: 'First step.', position: 1 }],
          null,
          2,
        ),
        'utf-8',
      )

      const originalArgv = process.argv
      process.argv = [
        'node',
        'continuum',
        'task',
        'steps',
        'add',
        task.id,
        '--steps',
        `@${stepsPath}`,
      ]

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        const output = logs.join('\n')
        expect(output).toContain('Updated steps for')
        expect(output).toContain('Next steps:')
        expect(output).toContain('continuum task steps complete')
        expect(output).toContain('continuum task validate')
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('task steps add validates schema', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()
      const task = await continuum.task.create({
        title: 'Validate steps',
        type: 'feature',
        description: 'Ensure schema validation fires.',
      })
      const stepsPath = join(process.cwd(), 'steps.json')
      writeFileSync(
        stepsPath,
        JSON.stringify([{ description: 'Missing title' }], null, 2),
        'utf-8',
      )

      const originalArgv = process.argv
      process.argv = [
        'node',
        'continuum',
        '--json',
        'task',
        'steps',
        'add',
        task.id,
        '--steps',
        `@${stepsPath}`,
      ]

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        const output = logs.join('\n')
        expect(output).toContain('"ok": false')
        expect(output).toContain('Invalid steps input')
        expect(output).toContain('steps[0].title')
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('task steps complete warns on duplicate completion', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()
      const task = await continuum.task.create({
        title: 'Duplicate completion warning',
        type: 'feature',
        description: 'Warn when completing the same step twice.',
      })
      const withSteps = await continuum.task.steps.add(task.id, {
        steps: [
          {
            title: 'Step 1',
            description: 'First step.',
            position: 1,
          },
        ],
      })
      const stepId = withSteps.steps[0]?.id
      if (!stepId) {
        throw new Error('Missing step id')
      }

      const originalArgv = process.argv
      process.argv = [
        'node',
        'continuum',
        'task',
        'steps',
        'complete',
        task.id,
        '--step-id',
        stepId,
      ]

      try {
        await withCapturedLogs(async () => {
          await main()
        })
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        const output = logs.join('\n')
        expect(output).toContain('Warning:')
        expect(output).toContain('already completed')
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('task notes flush appends all discoveries and decisions to NOW', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()
      const task = await continuum.task.create({
        title: 'Flush notes task',
        type: 'feature',
        description: 'Verify task notes flush writes to NOW.',
      })
      await continuum.task.notes.add(task.id, {
        kind: 'discovery',
        content: 'Found an API edge case',
        impact: 'Adds a validation requirement',
        source: 'agent',
      })
      await continuum.task.notes.add(task.id, {
        kind: 'decision',
        content: 'Use explicit parsing',
        rationale: 'Avoid implicit coercion bugs',
        impact: 'Improves reliability',
        source: 'agent',
      })

      const originalArgv = process.argv
      process.argv = ['node', 'continuum', 'task', 'notes', 'flush', task.id]

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        const output = logs.join('\n')
        expect(output).toContain(
          'Flushed 1 discovery(s) and 1 decision(s) to NOW.',
        )

        const nowPath = getCurrentSessionPath()
        expect(nowPath).not.toBeNull()
        if (!nowPath) {
          throw new Error('Expected NOW session file after flushing notes')
        }
        const content = readFileSync(nowPath, 'utf-8')
        expect(content).toContain(`[Discovery from ${task.id}]`)
        expect(content).toContain(`[Decision from ${task.id}]`)
        expect(content).toContain('Rationale: Avoid implicit coercion bugs')
        expect(content).toContain('Impact: Improves reliability')
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('task notes flush with empty notes prints nothing-to-flush', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()
      const task = await continuum.task.create({
        title: 'Flush empty notes task',
        type: 'feature',
        description: 'Verify no-op flush behavior.',
      })

      const originalArgv = process.argv
      process.argv = ['node', 'continuum', 'task', 'notes', 'flush', task.id]

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        const output = logs.join('\n')
        expect(output).toContain('No notes to flush.')
        expect(getCurrentSessionPath()).toBeNull()
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('task notes flush with unknown task id returns error', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()

      const originalArgv = process.argv
      process.argv = [
        'node',
        'continuum',
        '--json',
        'task',
        'notes',
        'flush',
        'tkt-doesnotexist',
      ]

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        const output = logs.join('\n')
        expect(output).toContain('"ok": false')
        expect(output).toContain("Task 'tkt-doesnotexist' not found.")
      } finally {
        process.argv = originalArgv
      }
    })
  })
})

describe('cli input', () => {
  test("readInput rejects '@-' without stdin", async () => {
    await expect(readInput('@-')).rejects.toThrow(
      "No stdin detected for '@-'. Pipe input, use a heredoc, or use @file instead.",
    )
  })
})

describe('memory session CLI', () => {
  test('memory collect opencode writes local artifacts from sqlite data', async () => {
    await withTempCwd(async () => {
      const repoRoot = process.cwd()
      const dbPath = join(repoRoot, 'opencode.db')
      seedOpencodeCliDb(dbPath, repoRoot)

      const originalArgv = process.argv
      process.argv = [
        'node',
        'continuum',
        'memory',
        'collect',
        '--source',
        'opencode',
        '--db',
        dbPath,
        '--no-summarize',
      ]

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        const output = logs.join('\n')
        expect(output).toContain('Memory collect:')
        expect(output).toContain('Sessions processed: 1')
        expect(
          existsSync(
            join(
              repoRoot,
              '.continuum',
              'recall',
              'opencode',
              'OPENCODE-NORMALIZED-2026-03-07T20-00-00-ses_cli.md',
            ),
          ),
        ).toBe(true)
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('memory init from nested subdir targets repo root', async () => {
    await withTempCwd(async () => {
      const repoRoot = process.cwd()
      const nested = join(repoRoot, 'apps', 'web')
      mkdirSync(join(repoRoot, '.git'), { recursive: true })
      mkdirSync(nested, { recursive: true })
      process.chdir(nested)

      const originalArgv = process.argv
      process.argv = ['node', 'continuum', 'memory', 'init']

      try {
        await withCapturedLogs(async () => {
          await main()
        })
        expect(
          existsSync(join(repoRoot, '.continuum', 'memory', '.gitignore')),
        ).toBe(true)
        expect(existsSync(join(nested, '.continuum'))).toBe(false)
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('memory list uses explicit --cwd workspace target', async () => {
    await withTempCwd(async () => {
      const outerRoot = process.cwd()
      const repoRoot = join(outerRoot, 'repo')
      const nested = join(repoRoot, 'apps', 'web')
      const memoryDir = join(repoRoot, '.continuum', 'memory')
      mkdirSync(join(repoRoot, '.git'), { recursive: true })
      mkdirSync(nested, { recursive: true })
      mkdirSync(memoryDir, { recursive: true })
      writeFileSync(
        join(memoryDir, 'NOW-2026-02-02T16-10-00.md'),
        'hello',
        'utf-8',
      )

      const originalArgv = process.argv
      process.argv = ['node', 'continuum', '--cwd', nested, 'memory', 'list']

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        const output = logs.join('\n')
        expect(output).toContain('NOW-2026-02-02T16-10-00.md')
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('memory list prints memory files', async () => {
    await withTempCwd(async () => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })

      const nowFileName = 'NOW-2026-02-02T16-10-00.md'
      writeFileSync(join(memoryDir, nowFileName), 'hello', 'utf-8')
      writeFileSync(join(memoryDir, '.current'), nowFileName, 'utf-8')
      writeFileSync(join(memoryDir, 'RECENT.md'), 'recent', 'utf-8')
      writeFileSync(join(memoryDir, 'MEMORY.md'), 'memory', 'utf-8')

      const originalArgv = process.argv
      process.argv = ['node', 'continuum', 'memory', 'list']

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        const output = logs.join('\n')
        expect(output).toContain('Memory files:')
        expect(output).toContain(nowFileName)
        expect(output).toContain('RECENT.md')
        expect(output).toContain('MEMORY.md')
        expect(output).toContain('current,')
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('end --consolidate triggers consolidation', async () => {
    await withTempCwd(async () => {
      startSession()

      const originalArgv = process.argv
      process.argv = [
        'node',
        'continuum',
        'memory',
        'session',
        'end',
        '--consolidate',
      ]

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        expect(logs.some((line) => line.startsWith('Session ended:'))).toBe(
          true,
        )
        expect(
          logs.some((line) => line.startsWith('Consolidation complete:')),
        ).toBe(true)
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('user /exit ends the session', async () => {
    await withTempCwd(async () => {
      startSession()

      const originalArgv = process.argv
      process.argv = ['node', 'continuum', 'memory', 'append', 'user', '/exit']

      try {
        const logs = await withCapturedLogs(async () => {
          await main()
        })
        expect(logs.some((line) => line.startsWith('Session ended:'))).toBe(
          true,
        )
        expect(getCurrentSessionPath()).toBeNull()
      } finally {
        process.argv = originalArgv
      }
    })
  })

  test('SIGINT ends the session', async () => {
    await withTempCwd(async () => {
      startSession()

      const originalArgv = process.argv
      process.argv = ['node', 'continuum', 'memory', 'status']

      try {
        await main()
        process.emit('SIGINT')
        expect(getCurrentSessionPath()).toBeNull()
      } finally {
        process.argv = originalArgv
      }
    })
  })
})

function seedOpencodeCliDb(dbPath: string, repoRoot: string): void {
  const db = new Database(dbPath)
  const createdAt = Date.parse('2026-03-07T20:00:00.000Z')
  const updatedAt = Date.parse('2026-03-07T20:05:00.000Z')
  try {
    db.exec(`
      CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        parent_id TEXT,
        slug TEXT,
        directory TEXT,
        title TEXT,
        version TEXT,
        summary_additions INTEGER,
        summary_deletions INTEGER,
        summary_files INTEGER,
        time_created INTEGER,
        time_updated INTEGER
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        time_created INTEGER,
        time_updated INTEGER,
        data TEXT
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT,
        session_id TEXT,
        time_created INTEGER,
        time_updated INTEGER,
        data TEXT
      );
    `)

    db.query(
      'INSERT INTO project (id, worktree, time_created, time_updated) VALUES (?, ?, ?, ?)',
    ).run('proj_cli', repoRoot, createdAt, updatedAt)
    db.query(
      `INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, summary_additions, summary_deletions, summary_files, time_created, time_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'ses_cli',
      'proj_cli',
      null,
      'cli-session',
      repoRoot,
      'CLI Session',
      '1',
      0,
      0,
      0,
      createdAt,
      updatedAt,
    )
    db.query(
      'INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)',
    ).run(
      'msg_cli_user',
      'ses_cli',
      createdAt,
      createdAt,
      JSON.stringify({ role: 'user', time: { created: createdAt } }),
    )
    db.query(
      'INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      'part_cli_user',
      'msg_cli_user',
      'ses_cli',
      createdAt,
      createdAt,
      JSON.stringify({
        type: 'text',
        text: 'Need to update src/memory/types.ts for tkt-cli-test.',
        time: { start: createdAt, end: createdAt },
      }),
    )
  } finally {
    db.close()
  }
}
