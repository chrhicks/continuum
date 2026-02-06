import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CONTINUUM_DIR = '.continuum'
const LOOP_DIR = join(CONTINUUM_DIR, 'loop')
const REQUEST_FILE = join(LOOP_DIR, 'request.json')

export type LoopRequest = {
  count: number
  created_at: string
  selection_rule: string
  qa_policy: string
  resume_behavior: string
}

export function writeLoopRequest(count: number): string {
  mkdirSync(LOOP_DIR, { recursive: true })
  const request: LoopRequest = {
    count,
    created_at: new Date().toISOString(),
    selection_rule: 'highest priority, oldest created, ready-only',
    qa_policy: 'bun test + task QA steps + minimal smoke test',
    resume_behavior:
      'blocked tasks should include an unblock plan; next iteration may resume',
  }
  writeFileSync(REQUEST_FILE, JSON.stringify(request, null, 2), 'utf-8')
  return REQUEST_FILE
}
