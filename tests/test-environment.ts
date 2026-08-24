import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const isolatedHome = mkdtempSync(join(tmpdir(), 'continuum-test-home-'))
process.env.HOME = isolatedHome
process.env.XDG_DATA_HOME = join(isolatedHome, 'xdg-data')

process.on('exit', () => {
  rmSync(isolatedHome, { recursive: true, force: true })
})
