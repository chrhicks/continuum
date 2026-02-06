import { describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'

import { endSession, startSession } from '../src/memory/session'
import { parseFrontmatter } from '../src/utils/frontmatter'

function withTempCwd(run: () => void): void {
  const root = mkdtempSync(join(tmpdir(), 'continuum-session-'))
  const previous = process.cwd()
  try {
    process.chdir(root)
    run()
  } finally {
    process.chdir(previous)
    rmSync(root, { recursive: true, force: true })
  }
}

describe('startSession', () => {
  test('creates unique NOW filenames within the same minute', () => {
    withTempCwd(() => {
      const RealDate = globalThis.Date
      const fixed = new RealDate('2026-02-02T16:10:22.000Z')

      class MockDate extends RealDate {
        constructor(...args: ConstructorParameters<typeof Date>) {
          if (args.length === 0) {
            super(fixed.toISOString())
          } else {
            super(...args)
          }
        }

        static now(): number {
          return fixed.valueOf()
        }
      }

      globalThis.Date = MockDate
      try {
        const first = startSession()
        const second = startSession()

        expect(first.filePath).not.toBe(second.filePath)

        const memoryDir = join(process.cwd(), '.continuum', 'memory')
        const nowFiles = readdirSync(memoryDir).filter(
          (name) => name.startsWith('NOW-') && name.endsWith('.md'),
        )
        expect(nowFiles).toHaveLength(2)
        expect(nowFiles).toContain(basename(first.filePath))
        expect(nowFiles).toContain(basename(second.filePath))

        const pointer = readFileSync(
          join(memoryDir, '.current'),
          'utf-8',
        ).trim()
        expect(pointer).toBe(basename(second.filePath))
      } finally {
        globalThis.Date = RealDate
      }
    })
  })

  test('links parent_session to previous session', () => {
    withTempCwd(() => {
      const first = startSession()
      const second = startSession()

      const content = readFileSync(second.filePath, 'utf-8')
      const { frontmatter } = parseFrontmatter(content)

      expect(frontmatter.parent_session).toBe(first.sessionId)
    })
  })
})

describe('endSession', () => {
  test('handles invalid timestamp_start', () => {
    withTempCwd(() => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })
      const nowFile = join(memoryDir, 'NOW-2026-02-02T16-00-00.md')
      const content = [
        '---',
        'session_id: sess_test',
        'timestamp_start: not-a-timestamp',
        'timestamp_end: null',
        'duration_minutes: null',
        `project_path: ${process.cwd()}`,
        'tags: []',
        'parent_session: null',
        'related_tasks: []',
        'memory_type: NOW',
        '---',
        '',
        '# Session: sess_test - 2026-02-02 16:00 UTC',
        '',
      ].join('\n')
      writeFileSync(nowFile, content, 'utf-8')
      writeFileSync(
        join(memoryDir, '.current'),
        'NOW-2026-02-02T16-00-00.md',
        'utf-8',
      )

      const originalWarn = console.warn
      console.warn = () => {}
      try {
        endSession()
      } finally {
        console.warn = originalWarn
      }

      const updated = readFileSync(nowFile, 'utf-8')
      const { frontmatter } = parseFrontmatter(updated)
      expect(frontmatter.duration_minutes).toBe(null)
    })
  })
})
