# Continuum

Continuum is a local Bun CLI and TypeScript SDK for durable project tasks and agent memory. One SQLite database per project under `${XDG_DATA_HOME:-~/.local/share}/continuum/projects/` is canonical; Markdown memory files are generated, non-authoritative projections.

## Requirements

- Bun
- A local filesystem with SQLite support

## Install

```sh
bun run setup
```

This private package is linked locally as `continuum`.

## Quick Start

```sh
continuum init
continuum memory append agent "SQLite is canonical memory"
continuum memory consolidate
continuum summary
continuum memory search "canonical memory"
continuum guide
```

No memory session lifecycle is required. An append succeeds without a harness or session ID.

## CLI

Global options must precede the command:

- `--cwd <path>` resolves and operates on another workspace.
- `--json` emits `{ ok, data, meta }` envelopes.
- `--quiet` suppresses human output.

Workspace resolution walks upward from the effective working directory to the nearest `.continuum` or `.git` directory.

`continuum runtime` is a read-only diagnostic for runtime wiring. It reports the
storage generation, normalized workspace, exact CLI entrypoint, HOME, XDG data
home, and canonical database path without initializing or writing storage. Use
`continuum --cwd <absolute-workspace> --json runtime` in automation that must
fail closed when a different binary or storage root is selected.

### MCP

`continuum mcp` serves the primary agent interface over local stdio MCP. It
provides typed tools for:

- read-only runtime and canonical storage diagnostics
- workspace initialization and summary
- task CRUD, validation, graph queries, steps, and notes
- memory append, search, and consolidation
- OpenCode recall status and import

Each tool requires an absolute `workspace` path. Tool arguments are structured,
so multiline Markdown and shell-special characters are passed without shell
quoting. Configure an MCP client or gateway such as Executor to launch
`continuum mcp`.

When using Executor, read successful tool data from
`result.data.structuredContent`. Do not return the raw MCP response when
batching calls: it contains both a compact text status and the structured data.
Discover the connection-specific full tool path with `tools.search()` before
calling it; bare names such as `continuum_summary` are MCP names, not Executor
paths. Initialize only with the absolute repository root because initialization
does not search parent directories.

The CLI remains the human, scripting, and recovery interface.

### Tasks

`continuum task` provides persistent task planning and execution:

- `task list`, `task get`, `task create`, `task update`, `task complete`, and `task delete`
- `task steps add|update|complete|list`
- `task note add` and `task notes flush`
- `task validate`, `task graph`, and `task templates list`

Run `continuum guide task` or `continuum task --help` for current options and workflows.

### R2 backup

`continuum backup` creates one-way, immutable Cloudflare R2 recovery points:

```sh
continuum backup configure --bucket <dedicated-private-bucket>
continuum backup create
continuum backup list
continuum backup restore [--generation <id>] [--output <new-path>]
```

Continuum passes object operations to Wrangler and never reads or stores its credentials. Snapshots are WAL-aware SQLite logical snapshots with verified checksums and immutable manifests. Restore publishes a separate recovery database and never overwrites divergent local state. This is a strict single-writer backup protocol, not live or bidirectional synchronization. See `docs/R2-BACKUP-DESIGN.md` for identity linking, credentials, retention, recovery drills, and limitations.

### Memory

The supported memory workflow is:

```text
append -> consolidate -> summary/search
                 ^
                 |
       explicit recall import
```

- `memory append <user|agent|tool> <text...>` inserts one immutable journal row and refreshes `NOW.md`.
- `memory consolidate [--dry-run]` summarizes a stable pending sequence range, retains every source row, and refreshes generated projections.
- `memory search <query...>` searches raw journal and recall messages plus derived consolidations and recall summaries.
- `memory recall status` reports canonical recall inventory.
- `memory recall import [--db <path>] [--project <id>] [--session <id>] [--after <date>] [--limit <n>] [--dry-run]` manually imports OpenCode history.
- `memory migrate [--dry-run]` explicitly imports legacy Markdown, preserves source files, records each artifact, and records each completed migration run.

Search filters:

- `--tier <NOW|MEMORY|all>` selects pending raw journal evidence or derived history.
- `--source <memory|recall|all>` selects canonical source families.
- `--tags <comma-separated>` requires all listed journal tags.
- `--after <ISO date>` filters by evidence time.
- `--limit <n>` limits results after filtering and ranking.

### Summary

`continuum summary` queries tasks and canonical SQLite memory directly. It does not read `NOW.md`, `RECENT.md`, or `MEMORY.md` to construct the briefing.

Useful options are `--no-tasks`, `--no-memory`, `--limit <n>`, and `--memory-lines <n>`.

## Architecture

Commander is a thin argument adapter. Each memory or summary command creates one scoped Effect runtime containing explicit workspace, memory directory, database path, and one configured `bun:sqlite` handle. Application functions return Effects; the CLI boundary runs them and centrally renders success or schema-backed tagged operational errors. The exact tested runtime is `effect@4.0.0-beta.107`; it is pinned because beta APIs are not semver-stable. Runtime credentials and model settings are decoded through Effect `Config`, with deterministic `ConfigProvider` overrides in tests.

The canonical path is `${XDG_DATA_HOME:-~/.local/share}/continuum/projects/<project-id>/continuum.db`. The project ID is the SHA-256 hash of the normalized absolute workspace path, which is deterministic and avoids unsafe path text in filenames. It preserves local project isolation, but it is intentionally machine/path-local; future cross-machine linking needs an explicit portable project identity rather than assuming hashes match.

On `continuum init`, an existing `.continuum/continuum.db` is copied as a SQLite logical snapshot so committed WAL data is included. Continuum validates integrity before atomic publication and records `legacy-migration-receipt.json` beside the canonical database. It never modifies or deletes the source. Later commands call the source removable only while its exact fingerprint still matches the receipt; a changed source or an unproven divergent destination fails with actionable diagnostics.

SQLite uses:

- `busy_timeout = 5000`
- `foreign_keys = ON`
- WAL journal mode for concurrent local CLI readers and writers
- `synchronous = NORMAL`
- short synchronous write transactions with no LLM or filesystem work inside them

Canonical tables include:

- `tasks`
- `memory_checkpoints`, retained for legacy checkpoint migration
- immutable `memory_journal_entries`
- range-based `memory_consolidations`
- `memory_recall_sources`, versioned raw `memory_recall_messages`, and current `memory_recall_summaries`
- `memory_legacy_migrations` per-artifact audit records
- `memory_legacy_migration_runs` completed-run markers

Changed OpenCode sessions retain prior raw message versions indefinitely. Normal queries expose messages matching the source's current fingerprint and its current summary. Tool output is not imported as raw recall evidence.

Generated files under `.continuum/memory/` are compatibility and portability projections:

- `NOW.md` contains pending journal entries.
- `RECENT.md`, `MEMORY-YYYY-MM-DD.md`, and `MEMORY.md` render completed consolidations.

Deleting projections does not delete canonical memory. Normal append and consolidation operations regenerate the relevant output.

## Configuration

The database path and workspace are resolved explicitly for each CLI runtime. `XDG_DATA_HOME` selects the user-level data root; otherwise Continuum uses `$HOME/.local/share`. `.continuum/memory/config.yml` and generated Markdown projections remain project-local. `.continuum/continuum.db` is legacy input only and receives no new writes after migration.

R2 backup configuration is project-local at `.continuum/r2-backup.json`. It contains a portable project UUID, a single-writer UUID, and a private bucket name, but no credentials. `CLOUDFLARE_API_TOKEN` is inherited directly by the configured Wrangler child process; `CONTINUUM_WRANGLER` may select its executable without putting secrets in command arguments.

LLM environment fallbacks include:

- API key: `OPENCODE_ZEN_API_KEY`, then `CONSOLIDATION_API_KEY`, then `OPENAI_API_KEY`
- Model: `SUMMARY_MODEL`, then `CONSOLIDATION_MODEL`, then the built-in default

`XDG_DATA_HOME` changes automatic OpenCode database discovery from the default `~/.local/share/opencode/opencode.db`.

## SDK

The public SDK currently exposes task operations only:

```ts
import continuum from 'continuum-memory-mvp'

await continuum.task.init()
const task = await continuum.task.create({ title: 'Ship', type: 'feature' })
await continuum.task.complete(task.id, { outcome: 'Shipped' })
```

Memory remains CLI-only; there is no public memory SDK compatibility contract.

## Development

```sh
bun run format
bun run typecheck
bun test
bun run validate
git diff --check
```

`bun run validate` runs typechecking, the full test suite, and goal-invariant verification. Migrations are additive SQL files under `drizzle/` and are applied by `src/db/migrate.ts`.

See `CONTRIBUTING.md`, `AGENTS.md`, and `PLAN/CHECKLIST.md` for repository workflows and release scope. R2 backup setup, safety contracts, retention, and recovery procedures are in `docs/R2-BACKUP-DESIGN.md`.

## License

MIT. See `LICENSE`.
