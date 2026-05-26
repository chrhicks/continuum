import { existsSync, writeFileSync } from 'node:fs'
import { ensureMemoryDir, memoryPath } from './paths'

const GITIGNORE_CONTENT = '*.tmp\n*.private\n.lock\nconsolidation.log.old\n'

const DEFAULT_CONFIG_CONTENT = `now_max_lines: 200
now_max_hours: 6
recent_session_count: 3
recent_max_lines: 500
memory_sections:
  - Architecture Decisions
  - Technical Discoveries
  - Development Patterns
#
# Uncomment to enable LLM-powered summary generation for opencode sessions:
# consolidation:
#   api_key: your-api-key
#   api_url: https://opencode.ai/zen/v1/responses
#   model: gpt-5.4-mini
#   max_tokens: 4000
#   timeout_ms: 120000
#   summary_max_chars: 40000
#   summary_max_lines: 1200
#   merge_max_est_tokens: 12000
`

export function initMemory(): void {
  ensureMemoryDir()

  const gitignorePath = memoryPath('.gitignore')
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, GITIGNORE_CONTENT, 'utf-8')
  }

  const logPath = memoryPath('consolidation.log')
  if (!existsSync(logPath)) {
    writeFileSync(logPath, '', 'utf-8')
  }

  const configPath = memoryPath('config.yml')
  if (!existsSync(configPath)) {
    writeFileSync(configPath, DEFAULT_CONFIG_CONTENT, 'utf-8')
  }
}
