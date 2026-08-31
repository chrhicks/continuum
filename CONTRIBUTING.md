# Contributing to Continuum

Continuum is a Bun workspace for durable, workspace-scoped agent memory. This document owns contributor setup and verification. Product usage belongs in [README.md](./README.md), architectural judgment in [AGENTS.md](./AGENTS.md), and coding defaults in [CODING_STANDARDS.md](./CODING_STANDARDS.md).

## Setup

Install Bun 1.4 or newer and Git, then install the frozen workspace dependencies:

```sh
bun install --frozen-lockfile
```

For a globally linked development executable:

```sh
bun run setup
continuum --help
```

Without a global link, use `bun run continuum --help`.

Do not point development commands at a live or default Continuum database. Tests isolate `CONTINUUM_DATA_DIR` or pass an explicit temporary `dataDirectory`.

## Workspace layout

```text
apps/cli/          Commander CLI and executable composition
packages/core/     workspace identity, memory behavior, retrieval, SQLite
packages/mcp/      MCP schemas, tools, lifecycle, and stdio transport
tools/import-v1/   one-time read-only legacy source importer
```

Runtime dependency direction is:

```text
apps/cli ───────→ packages/core
    │
    └───────────→ packages/mcp ───────→ packages/core

tools/import-v1 ──────────────────────→ packages/core
```

Import another package through its root export. Do not reach into a sibling package's source tree. Keep SQLite and memory invariants in core, MCP concerns in the MCP package, command parsing in the CLI app, and legacy source interpretation in the importer.

## Development workflow

Run the narrowest useful test while changing a feature:

```sh
bun test packages/core/tests/records.test.ts
bun test packages/core/tests/retrieval.test.ts
bun test packages/mcp/tests/server.test.ts
bun test apps/cli/tests/memory-commands.test.ts
bun test tools/import-v1
```

Before committing, run the full repository gates:

```sh
bun run typecheck
bun run validate
bun install --frozen-lockfile --dry-run
bunx prettier --check package.json tsconfig.json README.md CONTRIBUTING.md \
  AGENTS.md CODING_STANDARDS.md apps packages tools .github/workflows/ci.yml
git diff --check
```

`bun run validate` runs TypeScript and all active package, adapter, and importer tests. Use `bun run format` to apply Prettier when needed, then inspect the resulting diff rather than treating formatting as a design review.

Keep the worktree free of generated databases, WAL/SHM/journal sidecars, temporary reports, and staged files you did not intend to commit. Never commit `.tmp`, `.continuum`, `.agents`, private memory, credentials, or local absolute paths.

## Tests

Tests live with the package that owns the behavior:

- `packages/core/tests` protects database, workspace, record, retrieval, cursor, and migration behavior.
- `packages/mcp/tests` protects schemas, tool results, protocol behavior, and lifecycle.
- `apps/cli/tests` protects real subprocess output, CLI parity, and MCP stdio composition.
- `tools/import-v1/tests` protects preservation, exclusions, idempotency, collision handling, and source safety.

Prefer behavior through a public package interface and a real temporary SQLite database. Use mocks only for a genuinely external or timing-specific boundary. Tests should create isolated temporary directories, close every Continuum/database/server/client instance, and remove temporary files in cleanup hooks.

Never use a real user database, the default XDG database, or a private reference database as a committed fixture. Importer tests must build synthetic SQLite sources containing only invented data. Private migration evidence may be inspected only under an explicitly authorized workflow, read-only and through a disposable copy; no content may enter tests, logs, snapshots, documentation, or review artifacts.

## Database changes

Core migrations live in `packages/core/src/database/migrations.ts`. Add a new numbered migration rather than rewriting a released schema version. Keep SQL readable and close to the feature it supports.

When changing persistence:

1. test a fresh database;
2. test upgrade from the affected prior `PRAGMA user_version` when relevant;
3. preserve canonical immutable records;
4. keep canonical writes and derived FTS maintenance atomic;
5. verify foreign keys, WAL lifecycle, and transaction rollback behavior;
6. treat FTS as rebuildable rather than canonical evidence.

Do not add another ORM, database package, migration framework, or compatibility layer for speculative variation.

## Core and adapter boundaries

Core accepts plain TypeScript contracts, returns complete structured data, and never prints. It owns normalization and invariants that depend on stored state, such as workspace identity, same-workspace supersession, immutable insertion, current/history filtering, and cursor scope.

MCP validates untrusted tool input with Zod and exposes strict successful output schemas. CLI parses command-line syntax and writes compact JSON. Both adapters call the same core operations and must remain semantically equivalent. A behavior change to summary, record, search, or get normally needs core tests plus affected MCP and CLI parity tests.

MCP stdout is protocol-only. CLI success is JSON on stdout; CLI failure is safe JSON on stderr. Do not log record content, causes, SQL, or stacks from transport error mapping.

## Legacy importer changes

`tools/import-v1` is intentionally separate from runtime adapters. It may depend on the public core package but must not add import fields to MCP or the main CLI.

Importer changes must preserve these properties:

- source access is immutable and read-only;
- the full source is validated before target construction;
- only raw journal evidence is read;
- content and IDs are preserved, timestamp instants are represented canonically, and tags/kinds use core normalization;
- unrelated legacy tables and metadata remain ignored;
- identical reruns are safe;
- collisions never overwrite canonical evidence;
- source and target files cannot alias, including SQLite sidecar paths;
- failures and test evidence never reveal source content.

Use synthetic fixtures and verify source hashes, mtimes, directory entries, and sidecars when changing source-safety behavior.

## CI

`.github/workflows/ci.yml` uses Bun 1.4.0 and runs:

1. frozen dependency installation;
2. Prettier checks over active code, configuration, and documentation;
3. `bun run validate`;
4. `git diff --check`.

Run the same commands locally before requesting review. CI is a verification boundary, not a replacement for inspecting the behavior and diff.

## Change quality

Follow [CODING_STANDARDS.md](./CODING_STANDARDS.md): keep the critical path direct, use abstractions only for stable concepts, keep package exports narrow, and test valuable behavior rather than implementation choreography.

Do not add dependencies, public operations, compatibility surfaces, or workflow systems without a concrete product need and explicit architectural agreement. Remove stale documentation and obsolete code instead of preserving competing generations of behavior.
