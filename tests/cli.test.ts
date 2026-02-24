import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
  try {
    process.chdir(root)
    await run()
  } finally {
    process.chdir(previous)
    rmSync(root, { recursive: true, force: true })
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
})

describe('cli input', () => {
  test("readInput rejects '@-' without stdin", async () => {
    await expect(readInput('@-')).rejects.toThrow(
      "No stdin detected for '@-'. Pipe input, use a heredoc, or use @file instead.",
    )
  })
})

describe('memory session CLI', () => {
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
