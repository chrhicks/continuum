import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

type SkillRunner = (skillName: string, input?: unknown) => void | Promise<void>

export type LoopRunnerResult = {
  invoked: boolean
  message: string
  requestPath: string
}

export async function runLoopRequest(
  requestPath?: string,
): Promise<LoopRunnerResult> {
  const path = requestPath ?? join('.continuum', 'loop', 'request.json')
  if (!existsSync(path)) {
    return {
      invoked: false,
      message: 'No loop request found.',
      requestPath: path,
    }
  }

  const rawRequest = readFileSync(path, 'utf-8')
  let request: Record<string, unknown>
  try {
    request = JSON.parse(rawRequest) as Record<string, unknown>
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      invoked: false,
      message: `Invalid loop request JSON: ${message}`,
      requestPath: path,
    }
  }

  const runner = resolveSkillRunner()
  if (!runner) {
    return {
      invoked: false,
      message:
        'Agent loop skill tool unavailable. Request saved for external processing.',
      requestPath: path,
    }
  }
  try {
    await runner('agent-loop', { requestPath: path, request })
    unlinkSync(path)
    return {
      invoked: true,
      message: 'Agent loop skill invoked.',
      requestPath: path,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      invoked: false,
      message: `Agent loop skill failed: ${message}`,
      requestPath: path,
    }
  }
}

function resolveSkillRunner(): SkillRunner | null {
  const candidate =
    (
      globalThis as {
        opencode?: { runSkill?: SkillRunner }
        runSkill?: SkillRunner
      }
    ).opencode?.runSkill ?? (globalThis as { runSkill?: SkillRunner }).runSkill
  return typeof candidate === 'function' ? candidate : null
}
