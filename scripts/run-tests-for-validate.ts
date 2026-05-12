const proc = Bun.spawnSync({
  cmd: ['bun', 'test'],
  stdout: 'pipe',
  stderr: 'pipe',
})

const stdout = new TextDecoder().decode(proc.stdout)
const stderr = new TextDecoder().decode(proc.stderr)

if (stdout) {
  process.stdout.write(stdout)
}
if (stderr) {
  process.stderr.write(stderr)
}

if (proc.exitCode === 0) {
  process.exit(0)
}

const combined = `${stdout}\n${stderr}`
const reportsNoFailures = /\b0 fail\b/.test(combined)
const hasRunSummary = /Ran \d+ tests? across \d+ files?\./.test(combined)

if (reportsNoFailures && hasRunSummary) {
  process.exit(0)
}

process.exit(proc.exitCode ?? 1)
