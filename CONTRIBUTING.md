# Contributing to Continuum

Thanks for your interest in contributing. Continuum is a local CLI and SDK that gives coding agents durable task tracking and project memory. This doc covers setup, code standards, and the validation workflow.

## Setup

Requires [Bun](https://bun.sh) and a `better-sqlite3`-compatible native toolchain.

```sh
bun run setup          # bun install && bun link (puts `continuum` on your PATH)
```

Or manually: `bun install && bun run install:global`.

Verify it works:

```sh
continuum task list --json   # smoke-test
bun run typecheck
```

## Development workflow

Run these before sending changes:

```sh
bun run format       # prettier --write . (config in .prettierrc: no semi, single quotes, 2-space)
bun run typecheck    # tsc --noEmit
bun test             # full test suite
bun run validate     # typecheck + bun test (quirk-tolerant) + GOAL invariant checker
```

`bun run validate` is the canonical gate — it chains all three checks. See the README's Development section for what each stage does.

### Tests

Tests live in `tests/` (not colocated with source) and use `bun:test`. Common helpers:

- `withTempMemoryDir` / `withTempCwd` — temp dirs + cwd restoration.
- `snapshotConsolidationEnv` / `restoreConsolidationEnv` — snapshot/restore the `OPENCODE_ZEN_API_KEY` / `CONSOLIDATION_API_KEY` / `OPENAI_API_KEY` / `SUMMARY_MODEL` env vars so tests don't trigger real LLM consolidation.

Imports use relative paths back into `src/`. Build fixture files (`NOW-*.md`, `MEMORY-*.md`, `MEMORY.md`, `RECENT.md`, `config.yml`) directly with `writeFileSync` and call into `src/` functions, passing the temp memory dir explicitly rather than relying on workspace resolution.

### Smoke-testing

Beyond `bun test`, exercise the actual CLI:

```sh
continuum task list --json
continuum summary --no-tasks
continuum memory recall status
```

These are also run by the GOAL invariant checker.

## Architecture

```
CLI → SDK → Task Service → Database
```

- **Drizzle** for ORM (`bun:sqlite` + `drizzle-orm` at runtime; `better-sqlite3` + `drizzle-kit` are dev-only).
- **Repository per domain**: `Task` gets `task.repository.ts` and `task.service.ts`. DB models are internal; the SDK interface is public (consumed by both the SDK export and the CLI).
- **Memory persistence is canonical SQLite**. Memory workflows use the exactly pinned Effect v4 beta for named operations, a scoped runtime service/layer, schema-backed errors and boundary decoding, and runtime `Config`. Markdown files are non-authoritative projections.

See the README's Architecture section for the memory tier model (NOW / RECENT / MEMORY) and storage layout.

## Code standards

These are enforced by `scripts/verify-goal-invariants.ts` (run via `bun run verify:goal`). A PR that fails any of them will fail `bun run validate`.

**Structural limits:**

- No file in `src/` exceeds 300 lines.
- No function or arrow assigned to a variable exceeds 80 lines.
- All exported functions have explicit return-type annotations.
- Zero `as any` casts in `src/`.

**Naming:**

- File names describe what the code does, not its relationship to another file. `*-helpers.ts`, `*-utils.ts`, `*-misc.ts` are dumping grounds and are rejected — prefer domain-named files (e.g. `memory-content-builders.ts`, not `consolidate-helpers.ts`).

**Single source of truth:**

- A constant, type, or interface is defined in exactly one place. Re-exporting from a second file is acceptable only at a public API boundary (the SDK surface). Internal barrel files that exist only to reshuffle imports are a defect.
- Nested re-export chains (`A → re-exports B → re-exports C → definition`) are a defect. Import directly from the defining module.
- No circular dependencies. If module A imports types from B and B imports functions from A, one of them is in the wrong file.
- Generic utilities used in more than one domain belong in a shared module, not copy-pasted across domain files.

**Splitting discipline:**

- Size limits serve clarity, not compliance. Split when each part is easier to understand independently — a split that exists only to pass a line-count check, with no coherent domain boundary, is worse than the original.
- No duplication as a side-effect of splitting. If a split requires a shared function, extract it to a single shared location and import from both. Identical private implementations in sibling files are a defect.

The full principles live in `GOAL.md` ("Code Standard Principles"); `GOAL-ROADMAP.md` is the audit log of the refactor that established them.

## Constraints

- New runtime dependencies require an explicit architectural decision. Effect is approved for canonical memory workflows and is pinned exactly at the tested v4 beta (`4.0.0-beta.107`) because beta APIs are not semver-stable; unrelated additions remain out of scope.
- No behavioral changes to existing CLI outputs, SDK interfaces, or test expectations.
- Changes are incremental: `bun test` passes after each file is modified, not just at the end.
- `snake_case` identifiers in `src/task/` are intentionally not renamed (deferred — invasive, high regression risk).
- Refactor `src/` only; don't touch `tests/`, `skills/`, `drizzle/`, or build config unless a `src/` change strictly requires it.

## Temporary files

When creating temporary files during development, use a local `.tmp/` directory — don't write outside the project directory.

## Sending changes

1. Run `bun run validate` locally (it runs typecheck, tests, and the GOAL invariant checker).
2. Keep commits focused and incremental.
3. Don't commit secrets or keys. Memory content may record agent sessions — never log secrets into memory files; use placeholders.
