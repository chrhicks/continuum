import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const FAKE_WRANGLER_TOKEN = 'fixture-token-never-print'

export type FakeWranglerMode =
  | 'success'
  | 'missing'
  | 'auth'
  | 'network'
  | 'failure'

export type FakeWrangler = {
  executable: string
  objectPath: string
  recordDirectory: string
}

export type FakeWranglerInvocation = {
  args: string[]
  environment: Record<string, string>
  filePath: string
}

export function createFakeWrangler(root: string): FakeWrangler {
  const fixtureRoot = join(root, 'fake-wrangler')
  const recordDirectory = join(fixtureRoot, 'record')
  const executable = join(fixtureRoot, 'wrangler')
  const objectPath = join(fixtureRoot, 'object-fixture')
  mkdirSync(recordDirectory, { recursive: true })
  writeFileSync(
    executable,
    [
      '#!/bin/sh',
      'set -eu',
      'record="${FAKE_WRANGLER_RECORD:?}"',
      ': > "$record/args"',
      'for argument in "$@"; do',
      '  printf \'%s\\n\' "$argument" >> "$record/args"',
      'done',
      'printf \'marker=%s\\n\' "${FAKE_CONTROLLED_MARKER-unset}" > "$record/environment"',
      'if [ -n "${CLOUDFLARE_API_TOKEN+x}" ]; then',
      '  printf \'tokenPresent=true\\n\' >> "$record/environment"',
      'else',
      '  printf \'tokenPresent=false\\n\' >> "$record/environment"',
      'fi',
      'printf \'ambient=%s\\n\' "${FAKE_AMBIENT_SECRET-unset}" >> "$record/environment"',
      'operation=',
      'file=',
      'previous=',
      'for argument in "$@"; do',
      '  if [ "$previous" = "--file" ]; then file="$argument"; fi',
      '  case "$argument" in get|put) operation="$argument" ;; esac',
      '  previous="$argument"',
      'done',
      'printf \'%s\\n\' "$file" > "$record/file-path"',
      'case "${FAKE_WRANGLER_MODE:-success}" in',
      "  missing) printf 'R2 object not found (404 NoSuchKey)\\n' >&2; exit 1 ;;",
      "  auth) printf 'Authentication failed (error 10000)\\n' >&2; exit 1 ;;",
      "  network) printf 'Network request timed out\\n' >&2; exit 2 ;;",
      "  failure) printf 'Unexpected wrangler process failure\\n' >&2; exit 7 ;;",
      'esac',
      'if [ "$operation" = "get" ]; then',
      '  cp "${FAKE_WRANGLER_OBJECT:?}" "$file"',
      'elif [ "$operation" = "put" ]; then',
      '  cp "$file" "$record/upload"',
      'else',
      "  printf 'Unsupported fake Wrangler invocation\\n' >&2",
      '  exit 64',
      'fi',
    ].join('\n') + '\n',
    { mode: 0o700 },
  )
  return { executable, objectPath, recordDirectory }
}

export function fakeWranglerEnvironment(
  fake: FakeWrangler,
  mode: FakeWranglerMode,
): NodeJS.ProcessEnv {
  return {
    PATH: '/usr/bin:/bin',
    CLOUDFLARE_API_TOKEN: FAKE_WRANGLER_TOKEN,
    FAKE_CONTROLLED_MARKER: 'controlled-test-environment',
    FAKE_WRANGLER_MODE: mode,
    FAKE_WRANGLER_OBJECT: fake.objectPath,
    FAKE_WRANGLER_RECORD: fake.recordDirectory,
  }
}

export function readFakeWranglerInvocation(
  fake: FakeWrangler,
): FakeWranglerInvocation {
  const args = readFileSync(join(fake.recordDirectory, 'args'), 'utf8')
    .trimEnd()
    .split('\n')
  const environment = Object.fromEntries(
    readFileSync(join(fake.recordDirectory, 'environment'), 'utf8')
      .trimEnd()
      .split('\n')
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1)]
      }),
  )
  const filePath = readFileSync(
    join(fake.recordDirectory, 'file-path'),
    'utf8',
  ).trimEnd()
  return { args, environment, filePath }
}
