# Continuum

> A local CLI and SDK that gives coding agents durable task tracking and project memory — tasks persist to a SQLite database (`.continuum/continuum.db`), memory to markdown files in the workspace.

## Install

Continuum is a private, local-only package (not on npm). It requires [Bun](https://bun.sh) and a `better-sqlite3`-compatible native toolchain.

```sh
bun run setup          # bun install && bun link (puts `continuum` on your PATH)
```

Or manually:

```sh
bun install
bun run install:global   # bun link
```

## Quick Start

```sh
continuum init                   # create .continuum/continuum.db (task store)
continuum memory init            # create .continuum/memory/ (memory dir + config.yml)
continuum memory session start   # begin a session (opens the NOW log)
continuum task create --title "Ship X" --type feature --description "..."
continuum summary                # agent briefing: open tasks + memory excerpts
continuum guide                  # print the agent workflow guide
```

## CLI

### `continuum init`

Initialize the task database in the current directory. Creates `.continuum/continuum.db`. Idempotent — prints "already initialized" if it exists. Does **not** initialize memory (use `continuum memory init`).

### `continuum task`

Task management. Run `continuum task` with no subcommand for help.

- `task list` — list tasks (excludes completed/cancelled by default). Flags: `-s/--status`, `-t/--type`, `--parent`, `--include-deleted`, `--cursor`, `--limit`, `--sort`, `--order`.
- `task get <id>` (alias: `view`) — view a task. Flags: `--tree`, `--expand <parent,children,blockers,all>`, `--include-deleted`.
- `task create` — create a task. Flags: `--title`, `--type`, `--status`, `--priority`, `--intent`, `--description`, `--plan`, `--parent`, `--blocked-by`, or `--input <@file|@->` for JSON. `--title` and `--type` required. Auto-inits the DB if needed.
- `task update <id>` — update a task. Same field flags as `create` (minus required), plus `--patch <@file|@->`.
- `task complete <id>` — mark complete. Requires `--outcome <text|@file|@->`.
- `task delete <id>` — soft-delete a task.
- `task steps` (alias: `step`) — manage steps: `template [--schema]`, `add <id> --steps <json|@file|@->`, `update <id> <stepId> [--title|--status|--position|--summary|--notes|--patch]`, `complete <id> [--step-id|--notes]`, `list <id>`.
- `task note add <id>` — add a discovery or decision. Requires `--kind <discovery|decision>` and `--content`. Optional `--rationale`, `--impact`, `--source <user|agent|system>`.
- `task notes flush <id>` — flush a task's discoveries/decisions into the NOW memory log.
- `task validate <id> --transition <status>` — check whether a status transition is allowed (reports missing fields + open blockers).
- `task graph <ancestors|descendants|children> <id>` — query task graph relationships.
- `task templates list` — list available task types (`epic`, `feature`, `bug`, `investigation`, `chore`).

### `continuum memory`

Memory management. Run `continuum memory` for help.

- `memory init` — initialize the memory directory + `config.yml`.
- `memory session` — `start`, `end [--consolidate]`, `append <kind> <text...>`.
- `memory append <kind> <text...>` — append a `user`/`agent`/`tool` message to the current session. (`/exit` ends the session; `/exit --consolidate` ends + consolidates.)
- `memory consolidate [--dry-run]` — consolidate NOW → RECENT + MEMORY files.
- `memory search <query...>` — search memory. Flags: `--tier <NOW|RECENT|MEMORY|all>`, `--source <memory|recall|all>`, `--tags`, `--after`, `--mode <bm25|semantic|auto>`, `--limit`, `--summary-dir`.
- `memory collect` — collect source data (OpenCode sessions or tasks) into memory artifacts. Many flags; see `continuum memory collect --help`. Key: `--source <opencode|task>`, `--summarize`/`--no-summarize`, `--import`.
- `memory list` — list memory files.
- `memory status` — show NOW/RECENT/MEMORY sizes and last consolidation time.
- `memory log [--tail <n>]` — view consolidation log.
- `memory validate` — validate memory file structure/frontmatter/index links.
- `memory recover [--hours <n>] [--consolidate]` — recover stale NOW sessions.
- `memory repair recent [--dry-run]` — rebuild `RECENT.md` from MEMORY files.
- `memory recall` — `import [--summary-dir|--db|--project|--session|--dry-run]` and `search <query> [--mode|--limit|--summary-dir]`. (`recall index`/`diff`/`sync` are no longer supported.)

### Global flags

- `--json` — emit `{ ok, data, meta }` JSON on success / `{ ok: false, error }` on failure (skips human rendering).
- `--quiet` — suppress human output (no JSON either).
- `--cwd <path>` — run as if invoked from `<path>` (calls `process.chdir`).

**Project root resolution:** memory commands walk up from the (post-`--cwd`) working directory looking for a `.continuum/` or `.git/` marker; the first match becomes the workspace root. Task and `init` commands operate on `process.cwd()` directly (after any `--cwd` chdir).

## SDK

### Import + initialization

```ts
import continuum, {
  isContinuumError,
  isValidTaskType,
  TASK_TYPES,
} from 'continuum-memory-mvp'
import type { Task, TaskStatus, ContinuumSDK } from 'continuum-memory-mvp'
```

The SDK is stateless and resolves the working directory via `process.cwd()` on every call. Bootstrap a project's DB with:

```ts
const status = await continuum.task.init() // { success, created, ... }
```

### Tasks

All methods live on `continuum.task`:

- `init(): Promise<InitStatus>`
- `list(options?): Promise<ListTasksResult>`
- `get(id): Promise<Task | null>`
- `create(input: CreateTaskInput): Promise<Task>`
- `update(id, input?: UpdateTaskInput): Promise<Task>`
- `complete(id, input: { outcome }): Promise<Task>`
- `delete(id): Promise<void>`
- `validateTransition(id, nextStatus): Promise<TaskValidationResult>` — throws on `deleted`.
- `graph(query: 'ancestors'|'descendants'|'children', id): Promise<TaskGraphResult>`
- `steps.add(taskId, { steps }): Promise<Task>`
- `steps.update(taskId, stepId, input): Promise<Task>`
- `steps.complete(taskId, input?): Promise<TaskStepCompleteResult>`
- `notes.add(taskId, { kind: 'discovery'|'decision', content, ... }): Promise<Task>`

### Memory

The SDK does not currently expose memory — memory is CLI-only. Use the `continuum memory` commands or import internal modules from `src/memory/` directly.

## Architecture

### Memory tiers

Memory is a file-based subsystem under `.continuum/memory/`, organized in three tiers:

- **NOW** — the active session append-log. A single current `NOW-<timestamp>-<suffix>.md` file (tracked via `.continuum/memory/.current`), with YAML frontmatter (`session_id`, `tags`, `related_tasks`, `memory_type: NOW`). Rolls over when it exceeds `now_max_lines` (200) or `now_max_hours` (6). Old NOW files are pruned after 3 days.
- **RECENT** — one rolling `RECENT.md` capped at `recent_session_count` (3) sessions / `recent_max_lines` (500).
- **MEMORY** — durable long-term memory: one `MEMORY-<YYYY-MM-DD>.md` per day plus a top-level `MEMORY.md` index linking into them. Sections come from `memory_sections` (Architecture Decisions, Technical Discoveries, Development Patterns, Sessions).

**Consolidation flow:** NOW → (RECENT + `MEMORY-<date>.md` + `MEMORY.md` index) in a single pass, driven by `src/memory/consolidate.ts` + `src/memory/consolidation/`. Optionally uses an LLM to produce narrative summaries (see Configuration).

### File structure

```
src/
  cli.ts              # commander entry; wires subcommands + workspace context
  cli/                # CLI layer (commands/, io.ts)
  sdk/                # public SDK (index.ts + types/)
  task/               # task domain (service, repository, steps, notes, validation)
  memory/             # memory domain (session, now-writer, consolidate, collectors/, retrieval/, state/)
  recall/             # recall domain (opencode import/sync/search)
  db/                 # drizzle schema, client, migrations
  llm/                # LLM client (used by consolidation summarizer)
  workspace/          # workspace root resolution
  skills/             # skills scaffolding
  utils/              # frontmatter helpers
drizzle/              # generated SQL migrations
scripts/              # dev scripts (run-tests-for-validate, verify-goal-invariants, debug)
skills/               # agent skill definitions
tests/                # test suite (bun test)
```

### Storage

- **`.continuum/continuum.db`** (SQLite, via `bun:sqlite` + `drizzle-orm`) holds structured data only:
  - `tasks` — task records (id, title, type, status, priority, intent, description, plan, outcome, steps JSON, discoveries/decisions/blocked_by JSON arrays, parent_id, timestamps). Indexes on status/parent/priority.
  - `memory_checkpoints` — collector sync state (`source`/`scope`/`cursor`/`fingerprint`/`record_count`) so recall imports are incremental and idempotent.
- **`.continuum/memory/*.md`** holds all memory **content** (the NOW/RECENT/MEMORY tiers above) — plain markdown with YAML frontmatter, read/written directly from disk.

Migrations live in `drizzle/` and are applied at runtime by `src/db/migrate.ts`.

## Configuration

Configuration is scoped to the memory subsystem and lives in `.continuum/memory/config.yml` (created by `continuum memory init`). Defaults can be overridden by editing the file:

- `now_max_lines` / `now_max_hours` — NOW rollover thresholds.
- `recent_session_count` / `recent_max_lines` — RECENT sizing.
- `memory_sections` — section headings in `MEMORY-*.md` files.
- `consolidation` — optional LLM block (`api_url`, `api_key`, `model`, `max_tokens`, `timeout_ms`, `summary_max_chars`/`lines`, `merge_max_est_tokens`). The YAML template ships this commented out. Env fallbacks for the LLM block: `OPENCODE_ZEN_API_KEY` → `CONSOLIDATION_API_KEY` → `OPENAI_API_KEY`; `SUMMARY_MODEL` → `CONSOLIDATION_MODEL` → `gpt-5.4-mini`.

The workspace root is **auto-discovered** (walk up for `.continuum/` or `.git/`), not configured. `XDG_DATA_HOME` relocates the OpenCode DB lookup (`${XDG_DATA_HOME:-~/.local/share}/opencode/opencode.db`).

## Development

### Validate workflow (`bun run validate`)

Runs three stages, chained with `&&`:

1. `bun run typecheck` — `tsc --noEmit`.
2. `bun run scripts/run-tests-for-validate.ts` — `bun test` with a quirk-tolerant exit-code policy (Bun sometimes exits non-zero on clean runs).
3. `bun run verify:goal` — the GOAL invariant checker (below).

### GOAL invariant verification

`scripts/verify-goal-invariants.ts` uses the TypeScript compiler API to enforce the structural invariants declared in `GOAL.md` against `src/`:

- No `src/` file exceeds 300 lines.
- No function/arrow exceeds 80 lines.
- All exported functions have explicit return-type annotations.
- Zero `as any` casts in `src/`.
- No `*-helpers`/`*-utils`/`*-misc` dumping-ground files.
- Single-source-of-truth sentinels: each of `require_task`, `normalizeLimit`, `SUMMARY_PREFIX`, `formatStepMarker`, `buildSummaryLines`, `patch_collection`, `parsePositiveInteger`, `resolveRecallPath`, and the `createTaskCommand` decomposition defined exactly once and imported where used.
- Smoke-runs `bun run typecheck`, `bun test`, `continuum task list --json`, `continuum memory status`, and `continuum memory recall diff --help`.

Prints a `## Result` section; sets `process.exitCode = 1` on any failure.

### Tests

```sh
bun test        # full suite
bun run typecheck
```

Tests live in `tests/` (not colocated with source) and use `bun:test`. Common helpers: `withTempMemoryDir`/`withTempCwd` (temp dirs + cwd restoration) and `snapshotConsolidationEnv`/`restoreConsolidationEnv` (so tests don't trigger real LLM consolidation). Imports use relative paths back into `src/`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code standards, and the validation workflow.

## License

MIT — see [LICENSE](LICENSE).
