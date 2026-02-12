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
        const dbPath = join(process.cwd(), '.continuum', 'continuum.db')
        expect(existsSync(dbPath)).toBe(true)
        expect(
          logs.some((line) => line.includes('Initialized continuum')),
        ).toBe(true)
        expect(logs.some((line) => line.includes('created task'))).toBe(true)
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
})

describe('cli input', () => {
  test("readInput rejects '@-' without stdin", async () => {
    await expect(readInput('@-')).rejects.toThrow("No stdin detected for '@-'.")
  })
})

describe('memory session CLI', () => {
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
