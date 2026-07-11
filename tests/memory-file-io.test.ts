import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileAtomically } from '../src/memory/file-io'

describe('memory file I/O', () => {
  test('atomically replaces an existing file', () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-file-io-'))
    try {
      const path = join(root, 'state.json')
      writeFileSync(path, 'old', 'utf-8')

      writeFileAtomically(path, 'new')

      expect(readFileSync(path, 'utf-8')).toBe('new')
      expect(readdirSync(root)).toEqual(['state.json'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('cleans up its temporary file when replacement fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-file-io-'))
    try {
      const target = join(root, 'target')
      mkdirSync(target)

      expect(() => writeFileAtomically(target, 'content')).toThrow()
      expect(readdirSync(root)).toEqual(['target'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
