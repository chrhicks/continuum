import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigProvider, Effect, Redacted } from 'effect'
import { loadMemoryConfig, type MemoryConfig } from '../src/memory/config'

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

function readConfig(
  environment: Record<string, unknown>,
  memoryDir?: string,
): MemoryConfig {
  return Effect.runSync(
    loadMemoryConfig(memoryDir).pipe(
      Effect.provide(
        ConfigProvider.layer(ConfigProvider.fromUnknown(environment)),
      ),
    ),
  )
}

describe('memory config', () => {
  test('auto-enables consolidation from an Effect ConfigProvider', () => {
    withTempCwd(() => {
      const config = readConfig({ OPENCODE_ZEN_API_KEY: 'test-key' })
      const apiKey = config.consolidation?.api_key
      if (!apiKey) throw new Error('missing consolidation key')
      expect(Redacted.value(apiKey)).toBe('test-key')
      expect(JSON.stringify(config)).not.toContain('test-key')
      expect(config.consolidation?.api_url).toBe(
        'https://opencode.ai/zen/v1/responses',
      )
      expect(config.consolidation?.model).toBe('gpt-5.4-mini')
    })
  })

  test('config file values override runtime Config values', () => {
    withTempCwd(() => {
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
        'utf8',
      )

      const config = readConfig(
        { OPENCODE_ZEN_API_KEY: 'environment-key' },
        memoryDir,
      )
      const apiKey = config.consolidation?.api_key
      if (!apiKey) throw new Error('missing consolidation key')
      expect(Redacted.value(apiKey)).toBe('file-key')
      expect(JSON.stringify(config)).not.toContain('file-key')
      expect(config.consolidation?.model).toBe('file-model')
      expect(config.consolidation?.timeout_ms).toBe(1234)
    })
  })

  test('reports malformed YAML instead of treating it as absent', () => {
    withTempCwd(() => {
      const memoryDir = join(process.cwd(), '.continuum', 'memory')
      mkdirSync(memoryDir, { recursive: true })
      writeFileSync(
        join(memoryDir, 'config.yml'),
        'consolidation: [unterminated',
      )

      expect(() => readConfig({}, memoryDir)).toThrow(
        'Memory configuration is unreadable or malformed',
      )
    })
  })

  test('explicit memory directory does not read config from cwd', () => {
    withTempCwd(() => {
      const cwdMemory = join(process.cwd(), '.continuum', 'memory')
      const targetMemory = mkdtempSync(
        join(tmpdir(), 'continuum-target-memory-'),
      )
      mkdirSync(cwdMemory, { recursive: true })
      writeFileSync(
        join(cwdMemory, 'config.yml'),
        ['consolidation:', '  api_key: wrong-key', '  model: wrong-model'].join(
          '\n',
        ),
        'utf8',
      )
      try {
        expect(readConfig({}, targetMemory).consolidation).toBeUndefined()
      } finally {
        rmSync(targetMemory, { recursive: true, force: true })
      }
    })
  })
})
