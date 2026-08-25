# CHI-105 staging anti-slop audit

## Result

The staging branch is much safer than the original feature tip, but it is not ready for promotion without explicit decisions on three proposed follow-ups. Two affect storage safety, and one breaks the required worker validation path. A fourth, lower-priority backup finding is recorded but deferred under this audit's three-proposal cap.

No product fix is included in this audit. CHI-106, CHI-107, and CHI-108 are the three Backlog issues with `scout-proposal` so a Scout can prepare them without routing unreviewed scope directly to a Worker. F-014 has no active proposal from this audit.

## Comparison and coverage

```text
repository: chrhicks/continuum
base:       e693a594b36166025b21500642093aa8d5ea0da1 (origin/master)
head:       da464ba1e74f2311627705ce27203013ac5770d1 (origin/staging/xdg-storage-migration)
range:      origin/master...origin/staging/xdg-storage-migration
commits:    27
files:      113
lines:      7,759 additions, 811 deletions
```

The review covered every changed-file group:

- canonical XDG identity, migration, embedded lineage, receipt recovery, and path-hash adoption;
- R2 contracts, Effect services and errors, Wrangler adapter, backup, restore, status, and scheduling docs;
- memory Effect v4 config, redaction, repository and application changes;
- MCP read-only task, memory, runtime, graph, and summary paths;
- task and SDK adapters, CLI error rendering, workspace resolution, and LLM boundaries;
- Linear agent scripts, profiles, prompts, systemd units, runtime verification, and isolated validation;
- tests, package metadata, formatting rules, documentation, file modes, generated-file risk, and credential-like paths.

The earlier `review/xdg-storage-migration` artifacts supplied adversarial cases and the original F-001 through F-010 findings. This audit checked the current full range rather than treating those artifacts as current. CHI-98 through CHI-104 address the original findings under their stated acceptance criteria. The checks below found four additional gaps. The first three became follow-up proposals; F-014 is retained as deferred evidence because this audit is capped at three proposals.

The review applied the current Cursor `unslop` writing guidance, the `dmmulroy/anti-slop` rule descriptions, the repository's Effect v4 skill, the pinned `effect@4.0.0-beta.107` source contract, and project-local standards. Anti-slop warnings were treated as prompts for evidence, not as defects by themselves.

## Findings

### F-011 P1: copied workspaces silently share one canonical database

**What.** `src/db/paths.ts:66-99` trusts `.continuum/workspace.json` as the complete durable identity. Copying an initialized workspace copies that UUID. Both directories then resolve to the same `${XDG_DATA_HOME}/continuum/projects/<uuid>/continuum.db`.

**Why.** The reproduction initialized workspace A, appended `workspace-a-only`, copied A to B with `cp -a`, and appended `workspace-b-write` from B. A's summary then showed both entries. Both `runtime` commands printed the same database path. Writes, deletion, consolidation, and migration in either directory affect the other with no collision warning.

**How.** Track live path ownership for each stable UUID. If the recorded old path no longer exists, adopt the new path as a rename. If both paths exist, fail closed and require an explicit fork operation that gives the copy a new identity without overwriting either database.

Follow-up: [CHI-106](https://linear.app/chicks/issue/CHI-106/fail-closed-when-copied-workspaces-reuse-one-storage-identity)

### F-012 P1: canonical publication does not fsync directory entries

**What.** `src/db/storage-snapshot.ts:80-104` fsyncs staged file contents and then creates the authoritative name with `linkSync`. It does not fsync the destination directory. `src/db/storage-receipt.ts:62-78` and `src/db/paths.ts:72-103` publish receipt and identity names the same way.

**Why.** A file fsync does not make a newly created directory entry durable. Host or power loss can lose or reorder the database, identity, or receipt name after the command reports success. The earlier F-004 repair plan called for syncing both the staged file and destination directory, but the current implementation covers process interruption only.

**How.** Use one small no-overwrite publication primitive that syncs the destination directory after link creation. Sync the canonical database name before publishing and syncing the receipt. Apply the same rule to workspace identity. Preserve current conflict and cleanup behavior.

Follow-up: [CHI-107](https://linear.app/chicks/issue/CHI-107/fsync-canonical-publication-directories-before-recording-migration)

### F-013 P1: the isolated validation helper loses its configured Bun

**What.** `ops/linear-agent/bin/validate-continuum-worktree:15-20` resolves `CONTINUUM_VALIDATION_BUN_BIN`, but line 71 passes only the Continuum wrapper and inherited PATH to `bun run validate`. Nested package commands and `scripts/run-tests-for-validate.ts` invoke `bun` by name.

**Why.** The worker service PATH is `/home/chicks/.pi/agent/bin:/usr/local/bin:/usr/bin`; Bun is `/home/chicks/.bun/bin/bun`. With the absolute variable set, the staged helper completes runtime inspection and then fails with `/usr/bin/bash: bun: command not found`. The focused test runner fails with `Executable not found in $PATH: bun`. This breaks the validation route the worker protocol requires.

**How.** Put the configured Bun directory in the helper's private PATH or create a private `bun` wrapper next to its `continuum` wrapper. Add a smoke test whose inherited PATH has neither command.

Follow-up: [CHI-108](https://linear.app/chicks/issue/CHI-108/make-isolated-continuum-validation-resolve-its-configured-bun-binary)

### F-014 P2: overlapping same-writer backups can fork lineage

**What.** `src/backup/service.ts:60-79` reads the mutable head, uploads a generation, checks the head, and then publishes. `src/backup/remote.ts:102-133` separates that check from an unconditional put.

**Why.** A deterministic in-memory reproduction barriered two concurrent `createBackup` calls at both head reads. Both saw a null parent, both uploaded a manifest, both succeeded, and `listBackups` reached only one generation. The other successful generation became an orphan. `writerId` detects another identity but does not serialize two processes using the same identity. A manual command can overlap the optional timer.

**How.** Hold a per-project local lock across the complete create operation and return a typed contention error. This can prevent same-host overlap without pretending Wrangler offers remote compare-and-swap. Keep cross-machine concurrency unsupported and documented.

Deferred: this lower-priority finding exceeded the audit's three-proposal cap. No active follow-up proposal is retained; a future Scout may deduplicate and reconsider it in a separately bounded run.

## Validation evidence

These checks ran from the clean CHI-105 worktree at staging tip `da464ba1e74f2311627705ce27203013ac5770d1`:

```text
git diff --check origin/master...origin/staging/xdg-storage-migration
  pass

bun run typecheck
  pass

PATH=/home/chicks/.bun/bin:$PATH bun run scripts/run-tests-for-validate.ts
  132 pass, 0 fail

shellcheck -x ops/linear-agent/bin/* ops/linear-agent/tests/smoke.sh
  pass

PATH=/home/chicks/.bun/bin:$PATH \
  /home/chicks/workspaces/agents/continuum-control/ops/linear-agent/bin/validate-continuum-worktree \
  /home/chicks/workspaces/agents/continuum-control/.linear-agent-worktrees/CHI-105-anti-slop-audit
  pass: typecheck, 132 tests, GOAL invariants, and isolated CLI smoke commands
```

The PATH prefix is recorded rather than hidden. Running the staged helper with only `CONTINUUM_VALIDATION_BUN_BIN=/home/chicks/.bun/bin/bun` failed as described in F-013. The successful configured-helper run kept HOME, XDG data, and the smoke workspace temporary, so it did not touch the control ledger.

Additional checks inspected the complete name/status and mode summaries, tracked credential-like names, changed prose patterns, source size limits, suspicious error and mutation markers, and the current Linear project for duplicate findings. No credential, database, generated build output, or accidental source change appears in this PR.

## Dependency order

The three proposed follow-ups are independent once the current staging branch is their base. Fix CHI-108 first because it restores the normal validation path. Fix CHI-106 and CHI-107 before promotion because they affect canonical storage authority and durability. F-014 remains deferred under the proposal cap and does not block local database use.
