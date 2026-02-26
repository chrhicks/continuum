import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { MEMORY_DIR } from './paths'
import {
  validateConsolidatedMemoryFrontmatter,
  validateNowMemoryFrontmatter,
} from './memory-frontmatter-validation'
import { validateMemoryIndexLinks } from './memory-index-link-validation'

export type MemoryValidationError = {
  filePath: string
  lineNumber: number
  message: string
}

export type MemoryValidationResult = {
  errors: MemoryValidationError[]
  filesChecked: number
}

export function validateMemory(
  options: { memoryDir?: string } = {},
): MemoryValidationResult {
  const memoryDir = options.memoryDir ?? MEMORY_DIR
  if (!existsSync(memoryDir)) {
    return { errors: [], filesChecked: 0 }
  }

  const errors: MemoryValidationError[] = []
  const files = listMemoryFiles(memoryDir)
  for (const filePath of files) {
    const fileName = filePath.split('/').pop() ?? ''
    if (fileName.startsWith('NOW-')) {
      errors.push(...validateNowMemoryFrontmatter(filePath))
      continue
    }
    if (fileName.startsWith('MEMORY-')) {
      errors.push(...validateConsolidatedMemoryFrontmatter(filePath))
    }
  }

  const indexPath = join(memoryDir, 'MEMORY.md')
  if (existsSync(indexPath)) {
    errors.push(...validateMemoryIndexLinks(indexPath, memoryDir))
  }

  return {
    errors,
    filesChecked: files.length + (existsSync(indexPath) ? 1 : 0),
  }
}

function listMemoryFiles(memoryDir: string): string[] {
  return readdirSync(memoryDir)
    .filter((file) => /^NOW-.*\.md$/.test(file) || /^MEMORY-.*\.md$/.test(file))
    .map((file) => join(memoryDir, file))
}
