import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type SkillInstallResult = {
  sourceDir: string
  targetDir: string
  skills: string[]
}

export function installSkills(
  targetRoot: string = process.cwd(),
): SkillInstallResult {
  const sourceDir = resolveSkillsSourceDir()
  if (!existsSync(sourceDir)) {
    throw new Error(`Skills source directory not found: ${sourceDir}`)
  }

  const entries = readdirSync(sourceDir, { withFileTypes: true })
  const skills = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  if (skills.length === 0) {
    throw new Error(`No skills found in ${sourceDir}`)
  }

  const targetDir = join(targetRoot, '.agents', 'skills')
  mkdirSync(targetDir, { recursive: true })

  const rootSkillFile = join(targetDir, 'SKILL.md')
  if (existsSync(rootSkillFile) && statSync(rootSkillFile).isFile()) {
    rmSync(rootSkillFile)
  }

  for (const skill of skills) {
    const sourcePath = join(sourceDir, skill)
    const destinationPath = join(targetDir, skill)
    rmSync(destinationPath, { recursive: true, force: true })
    cpSync(sourcePath, destinationPath, { recursive: true, force: true })
  }

  return { sourceDir, targetDir, skills }
}

function resolveSkillsSourceDir(): string {
  return fileURLToPath(new URL('../../skills', import.meta.url))
}
