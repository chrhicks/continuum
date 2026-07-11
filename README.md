# Continuum

Continuum is a local Bun CLI and TypeScript SDK for durable project tasks and agent memory. SQLite at `.continuum/continuum.db` is canonical; Markdown memory files are generated, non-authoritative projections.

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

### Tasks

`continuum task` provides persistent task planning and execution:

- `task list`, `task get`, `task create`, `task update`, `task complete`, and `task delete`
- `task steps add|update|complete|list`
- `task note add` and `task notes flush`
- `task validate`, `task graph`, and `task templates list`

Run `continuum guide task` or `continuum task --help` for current options and workflows.

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

Commander is a thin argument adapter. Each memory or summary command creates one scoped Effect runtime containing explicit workspace, memory directory, database path, and one configured `bun:sqlite` handle. Application functions return Effects; the CLI boundary runs them and centrally renders success or tagged operational errors.

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

The database path and workspace are resolved explicitly for each CLI runtime. Optional consolidation and recall summarization settings are read from `.continuum/memory/config.yml` when present.

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

See `CONTRIBUTING.md`, `AGENTS.md`, and `PLAN/CHECKLIST.md` for repository workflows and release scope.

## License

MIT. See `LICENSE`.
