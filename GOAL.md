# Goal

## Outcome (one sentence)

The `src/` codebase is clean, consistent, and easy to navigate: no file exceeds 300 lines, no function exceeds 80 lines, duplicated patterns are consolidated into shared helpers, and the TypeScript type surface is explicit and free of `any` casts.

## Why it matters

Several source files have grown into monoliths (1000+ lines) that mix registration, business logic, and rendering in a single function. Duplication is spread across four CLI modules — the same parse-integer, resolve-path, and collection-patch patterns appear 3–4 times each with minor variations. Two `as any` casts silently bypass the type system. These conditions slow down every future change: large functions are hard to test in isolation, duplicated logic diverges under maintenance, and missing types produce runtime errors instead of compile-time failures.

## Success criteria

- No file in `src/` exceeds 300 lines (measured by `wc -l`).
- No function or arrow function assigned to a variable exceeds 80 lines.
- Zero `as any` casts in `src/` (confirmed by `grep -r 'as any' src/`).
- All exported functions have explicit return type annotations.
- The triplicated step-status marker logic is consolidated into a single `formatStepMarker` helper.
- The quadruplicated parse-positive-integer pattern in `memory.ts` is consolidated into one shared utility.
- The quadruplicated `resolve*Path` helpers in `memory.ts` are replaced by a single generic helper.
- `update_task` collection-patch logic (triplicated for steps, discoveries, decisions) is extracted into a generic reusable helper.
- `buildRecentEntry` and `buildMemorySection` in `consolidate.ts` share a common `buildSummaryLines` helper instead of being structural clones.
- `createTaskCommand` (currently 705 lines) is decomposed: each sub-command's handler is extracted into its own named function.
- `bun run typecheck` and `bun test` pass clean throughout all changes.

## Execution Plan

See `GOAL-ROADMAP.md` for the phased execution plan with specific file references, implementation guidance, and a success criteria check.

## Constraints

- No behavioral changes: all existing CLI outputs, SDK interfaces, and test expectations remain identical.
- Changes must be incremental: `bun test` passes after each file is modified, not just at the end.
- Do not rename `snake_case` identifiers in `src/task/` — this inconsistency is acknowledged and intentionally deferred.
- No new runtime dependencies.
- Refactor `src/` only; do not touch `tests/`, `skills/`, `drizzle/`, or build config unless a change in `src/` strictly requires a corresponding update.

## Non-goals

- Renaming `snake_case` identifiers in `src/task/` to `camelCase` (deferred — invasive with high regression risk).
- Adding a memory SDK boundary or recall service layer (architectural work deferred to a future goal).
- Adding new features or changing observable behavior.
- Improving test coverage (separate concern).
- LLM or consolidation quality improvements.
- Multi-repo or cross-project orchestration.
