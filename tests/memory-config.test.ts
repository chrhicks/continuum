import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { getMemoryConfig } from '../src/memory/config'

function withTempCwd(run: () => void): void {
  const root = mkdtempSync(join(tmpdir(), 'continuum-memory-config-'))
  const previous = process.cwd()
  try {
    process.chdir(root)
    run()
  } finally {
    process.chdir(previous)
    rmSync(root, { recursive: true, force: true })
  }
}

describe('memory config', () => {
  test('auto-enables consolidation when env credentials exist', () => {
    withTempCwd(() => {
      const originalKey = process.env.OPENCODE_ZEN_API_KEY
      const originalModel = process.env.SUMMARY_MODEL
      process.env.OPENCODE_ZEN_API_KEY = 'test-key'
      delete process.env.SUMMARY_MODEL

      try {
        const config = getMemoryConfig()
        expect(config.consolidation?.api_key).toBe('test-key')
        expect(config.consolidation?.model).toBe('kimi-k2.5')
      } finally {
        if (originalKey === undefined) {
          delete process.env.OPENCODE_ZEN_API_KEY
        } else {
          process.env.OPENCODE_ZEN_API_KEY = originalKey
        }
        if (originalModel === undefined) {
          delete process.env.SUMMARY_MODEL
        } else {
          process.env.SUMMARY_MODEL = originalModel
        }
      }
    })
  })

  test('config file values override env-derived consolidation defaults', () => {
    withTempCwd(() => {
      const originalKey = process.env.OPENCODE_ZEN_API_KEY
      process.env.OPENCODE_ZEN_API_KEY = 'env-key'
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })
      writeFileSync(
        join(memoryDir, 'config.yml'),
        [
          'consolidation:',
          '  api_key: file-key',
          '  model: file-model',
          '  timeout_ms: 1234',
        ].join('\n'),
        'utf-8',
      )

      try {
        const config = getMemoryConfig()
        expect(config.consolidation?.api_key).toBe('file-key')
        expect(config.consolidation?.model).toBe('file-model')
        expect(config.consolidation?.timeout_ms).toBe(1234)
      } finally {
        if (originalKey === undefined) {
          delete process.env.OPENCODE_ZEN_API_KEY
        } else {
          process.env.OPENCODE_ZEN_API_KEY = originalKey
        }
      }
    })
  })
})
