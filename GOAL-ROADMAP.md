# Goal Roadmap: Code Quality Refactoring

Remaining work toward the goal in `GOAL.md`.

---

## Completed

| Item     | What was done                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1a | `formatStepMarker` helper extracted in `task/render.ts`                                                                                           |
| Phase 1b | `parsePositiveInteger` / `parseOptionalPositiveInteger` consolidated in `cli/commands/shared.ts`                                                  |
| Phase 1c | `resolveRecallPath` generic helper replaces four path functions in `memory.ts`                                                                    |
| Phase 1d | `validate_parent_exists` extracted in `tasks.repository.ts`                                                                                       |
| Phase 2a | `buildSummaryLines` shared helper extracted in `consolidate.ts`                                                                                   |
| Phase 2b | `patch_collection` generic helper extracted in `tasks.repository.ts`                                                                              |
| Phase 3a | Zero `as any` casts in `src/`                                                                                                                     |
| Phase 3b | Explicit return types on all exported functions                                                                                                   |
| Phase 4a | `src/cli/commands/task.ts` split into `task/` directory (`parse.ts`, `render.ts`, `crud.ts`, `steps.ts`, `notes.ts`)                              |
| Phase 4b | `src/task/tasks.repository.ts` split into `parse.ts`, `list.ts`, `update.ts`, `steps.repository.ts`, `notes.repository.ts`, `collection-patch.ts` |
| Phase 4c | `src/memory/consolidate.ts` split into `consolidate-io.ts`, `consolidate-helpers.ts`, `memory-index.ts`                                           |
| Phase 4d | `src/cli/commands/memory.ts` split into `memory/` directory (`handlers.ts`, `recall.ts`, `recall-subcommands.ts`, etc.)                           |
| Phase 4e | `src/sdk/types.ts` split into `sdk/types/task-models.ts`, `task-operations.ts`, `continuum-sdk.ts`                                                |
| Phase 4f | `src/sdk/index.ts` decomposed — mappers extracted to `mappers.ts`, graph traversal to `graph.ts`                                                  |
| Phase 4g | `src/recall/opencode/extract.ts` reduced by extracting `extract-helpers.ts`                                                                       |
| Phase 4h | `src/recall/index/opencode-source-index.ts` reduced by extracting `opencode-source-index.helpers.ts`                                              |

---

## Open: Remaining File-Size Violations

Two files still exceed the 300-line cap.

| File                               | Lines | Task                  |
| ---------------------------------- | ----- | --------------------- |
| `src/recall/diff/opencode-diff.ts` | 479   | tkt-v85vqnvh (step 2) |
| `src/recall/sync/opencode-sync.ts` | 431   | tkt-v85vqnvh (step 2) |
| `src/memory/recall-import.ts`      | 475   | tkt-qefb2bem          |
| `src/memory/validate.ts`           | 349   | tkt-qefb2bem          |

---

## Phase 5: Code Standard Quality Fixes

The phase 4 splitting work introduced several violations of the Code Standard Principles added to `GOAL.md`. These must be resolved before the goal is complete. Each is an independent change.

The guiding principle: **size reduction must not come at the cost of duplication, circular dependencies, or navigability.** See `GOAL.md` for the full principles.

---

### 5a. Export `require_task` from a single source; remove copies in `steps` and `notes` repositories

**Problem:** The overnight split created identical private implementations of `require_task` in three files:

- `src/task/tasks.repository.ts:33`
- `src/task/steps.repository.ts:15`
- `src/task/notes.repository.ts:14`

All three are byte-for-byte identical. This is duplication as a direct side-effect of splitting.

**Fix:**

1. Make `require_task` in `tasks.repository.ts` an exported function.
2. Delete the private copies in `steps.repository.ts` and `notes.repository.ts`.
3. Import `require_task` from `tasks.repository.ts` in both files.

**Verification:** `bun test` passes; grep for `function require_task` returns exactly one result in `src/`.

---

### 5b. Delete `recall-handlers.ts` barrel; import handler modules directly

**Problem:** `src/cli/commands/memory/recall-handlers.ts` is 7 lines that re-export from three other files. It has one consumer (`recall.ts`). It exists only because files were split without cleaning up the intermediate re-export layer.

**Fix:**

1. Delete `recall-handlers.ts`.
2. In `recall.ts`, import `handleRecallImport`, `handleRecallIndex`, `handleRecallSearch` from `recall-basic-handlers.ts`, `handleRecallDiff` from `recall-diff-handler.ts`, and `handleRecallSync` from `recall-sync-handler.ts` directly.

**Verification:** `bun test` passes; `bun run bin/continuum memory recall diff --help` works.

---

### 5c. Remove redundant re-exports from `sdk/types/continuum-sdk.ts`

**Problem:** `continuum-sdk.ts` re-exports all types from `task-models.ts` and `task-operations.ts` (lines 58–76). Those types are already aggregated by `sdk/types.ts`. This creates a three-level re-export chain and means the same type is exported from four different paths.

**Fix:**

1. Remove the re-export block at the bottom of `continuum-sdk.ts` — it should only contain the `ContinuumSDK` interface definition.
2. Confirm `sdk/types.ts` still exports everything needed (it imports from all three files already).

**Verification:** `bun run typecheck` passes; `bun test` passes; SDK consumers that import from `sdk.d.ts` or `sdk/types.ts` still resolve all types.

---

### 5d. Remove `SdkUpdateTaskInput` duplicate type from `mappers.ts`

**Problem:** `mappers.ts` defines `SdkUpdateTaskInput` (line 20) which is structurally identical to `UpdateTaskInput` already exported from `sdk/types/task-operations.ts`. This is a redundant type definition introduced during the splitting work.

**Fix:**

1. Delete `SdkUpdateTaskInput` from `mappers.ts`.
2. Import `UpdateTaskInput` from `../types/task-operations` and use it everywhere `SdkUpdateTaskInput` was used.

**Verification:** `bun run typecheck` passes; `bun test` passes.

---

### 5e. Inline `opencode-source-index.helpers.ts` back into its parent

**Problem:** `src/recall/index/opencode-source-index.helpers.ts` is 34 lines containing 3 small functions (`toIso`, `indexBySessionId`, `buildSessionStats`). It is imported only by `opencode-source-index.ts`. It was split off purely to bring the parent under 300 lines and has no independent domain justification.

**Fix:**

1. Move the three functions back into `opencode-source-index.ts`.
2. Delete `opencode-source-index.helpers.ts`.
3. Confirm the parent file stays under 300 lines after the merge (it was 293 lines after the split, so will be ~327 — apply a targeted refactor to bring it back under 300 rather than keeping a 34-line satellite file).

**Verification:** `bun run typecheck` passes; `bun test` passes; no import references `opencode-source-index.helpers`.

---

### 5f. Restructure `extract.ts` / `extract-helpers.ts` to remove the circular type dependency

**Problem:** The two files have a mutual import cycle:

- `extract-helpers.ts` imports 5 types from `extract.ts`
- `extract.ts` imports 7 functions from `extract-helpers.ts`

Types and functions flow in opposite directions. This is the circular dependency defect described in `GOAL.md`.

**Fix:** Co-locate the row types with the row mappers. Two options:

- Move the 5 types (`SessionRow`, `MessageRow`, `PartRow`, `RecallArtifact`, `RecallGroup`) into `extract-helpers.ts` (or rename it to `extract-rows.ts`) so types and the functions that use them live together. `extract.ts` only imports from `extract-rows.ts`, not vice-versa.
- Alternatively, if the types are needed by other consumers, move them to a dedicated `extract-types.ts` that neither file imports from the other.

The chosen option should eliminate the circular import entirely.

**Verification:** `bun run typecheck` passes; `bun test` passes; no circular import between the two files.

---

### 5g. Deduplicate `normalizeLimit` into a shared recall utility

**Problem:** `normalizeLimit` is defined twice, byte-for-byte identically:

- `src/recall/opencode/summary-chunks.ts:91`
- `src/recall/opencode/summary-merge.ts:186`

This was created when the two files were split without consolidating shared utilities.

**Fix:**

1. Move `normalizeLimit` to `src/recall/opencode/recall-util.ts` (create if it doesn't exist).
2. Import it in both `summary-chunks.ts` and `summary-merge.ts`.

**Verification:** `bun test` passes; `grep -rn 'function normalizeLimit' src/` returns exactly one result.

---

### 5h. Centralize `SUMMARY_PREFIX` constant to `recall/opencode/paths.ts`

**Problem:** `SUMMARY_PREFIX = 'OPENCODE-SUMMARY-'` is defined in three separate files:

- `src/memory/recall-import.ts:64`
- `src/recall/diff/opencode-diff.ts:11`
- `src/recall/search/index.ts:7`

The canonical home for this constant is `src/recall/opencode/paths.ts`, which already owns the artifact filename format (`ARTIFACT_PREFIXES` with `summary: 'OPENCODE-SUMMARY'`).

**Fix:**

1. Add or align `SUMMARY_PREFIX` in `src/recall/opencode/paths.ts`.
2. Delete the three local definitions and import from `paths.ts`.

**Verification:** `bun test` passes; `grep -rn "SUMMARY_PREFIX\s*=" src/` returns exactly one result.

---

### 5i. Rename `consolidate-helpers.ts` to a name that describes its content

**Problem:** `src/memory/consolidate-helpers.ts` is a 294-line file named after its relationship to another file, not its own domain. It contains: date/time formatters, summary line builders, RECENT file parsers and builders, and MEMORY file builders. The name `*-helpers` is a catch-all that provides no navigability signal.

**Fix:**

1. Rename the file to `memory-content-builders.ts` (or split it: `memory-recent.ts` for RECENT builders/parsers, `memory-format.ts` for date/time formatters and summary line builders).
2. Update all import references.

Note: if splitting, ensure neither resulting file exceeds 300 lines and that each has a single coherent purpose.

**Verification:** `bun run typecheck` passes; `bun test` passes; no import references `consolidate-helpers`.

---

### 5j. Move OpenCode parsing logic from `memory/recall-import.ts` into `recall/opencode/`

**Problem:** `src/memory/recall-import.ts` (475 lines) contains OpenCode-specific parsing functions (`parseSections`, `parseFocus`, `parseList`, `extractSummaryTitle`, `readString`, `normalizeWhitespace`) that belong in the `recall/opencode/` module, which owns the OpenCode data format. These helpers are also near-duplicates of functions in `recall/diff/opencode-diff.ts`. The file is in the wrong domain.

**Fix:**

1. Audit which parsing helpers in `recall-import.ts` are already covered by functions in `recall/opencode/` or `recall/diff/`. Consolidate rather than duplicate.
2. Move remaining OpenCode-format parsing to `src/recall/opencode/` (a new `import-helpers.ts` or into an existing module if cohesive).
3. Import the consolidated helpers back into `recall-import.ts` for use in the import pipeline.
4. The refactored `recall-import.ts` should drop well below 300 lines.

**Verification:** `bun test` passes; `bun run bin/continuum memory recall import --help` works; no duplicate parsing helpers across `memory/` and `recall/`.

---

## Phase 6: Verify All Targets Met

After all phases complete, run a final check against every success criterion.

```bash
# No file over 300 lines
find src -name '*.ts' | xargs wc -l | sort -rn | head -20

# Zero as any casts
grep -r 'as any' src/

# Single source of truth checks
grep -rn 'function require_task' src/
grep -rn 'SUMMARY_PREFIX\s*=' src/
grep -rn 'function normalizeLimit' src/

# No barrel files (manual review of any file that only re-exports)

# All tests pass
bun run typecheck
bun test

# Smoke tests
bun run bin/continuum task list --json
bun run bin/continuum memory status
bun run bin/continuum memory recall diff --help
```

---

## Execution Order

```
Phase 5a–5d  ─── independent, any order (task/ and sdk/ fixes)
Phase 5e–5f  ─── independent (recall/index and recall/opencode fixes)
Phase 5g–5h  ─── after 5f (shared recall utilities, centralize constants)
Phase 5i     ─── independent (rename only)
Phase 5j     ─── after 5g–5h (depends on consolidated recall parsing)

Open size violations (tkt-v85vqnvh, tkt-qefb2bem) ─── parallel to Phase 5

Phase 6      ─── final verification after all phases complete
```

---

## Success Criteria Status

| Criterion                                                     | Status                                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| No file in `src/` exceeds 300 lines                           | **Partial** — 4 files remain (diff 479, recall-import 475, sync 431, validate 349) |
| No function exceeds 80 lines                                  | **Partial** — pending review of remaining large files                              |
| Zero `as any` casts                                           | Done                                                                               |
| All exported functions have explicit return types             | Done                                                                               |
| `formatStepMarker` helper consolidated                        | Done                                                                               |
| `parsePositiveInt` consolidated                               | Done                                                                               |
| `resolveRecallPath` consolidated                              | Done                                                                               |
| `buildSummaryLines` shared helper                             | Done                                                                               |
| `patch_collection` generic helper                             | Done                                                                               |
| `createTaskCommand` decomposed into per-sub-command functions | Done                                                                               |
| `require_task` defined once, imported everywhere              | **Pending** — Phase 5a                                                             |
| `recall-handlers.ts` barrel removed                           | **Pending** — Phase 5b                                                             |
| SDK types have one canonical export path                      | **Pending** — Phase 5c                                                             |
| `SdkUpdateTaskInput` duplicate type removed                   | **Pending** — Phase 5d                                                             |
| `opencode-source-index.helpers.ts` inlined                    | **Pending** — Phase 5e                                                             |
| `extract.ts`/`extract-helpers.ts` circular dep removed        | **Pending** — Phase 5f                                                             |
| `normalizeLimit` defined once                                 | **Pending** — Phase 5g                                                             |
| `SUMMARY_PREFIX` defined once                                 | **Pending** — Phase 5h                                                             |
| `consolidate-helpers.ts` renamed to descriptive name          | **Pending** — Phase 5i                                                             |
| OpenCode parsing consolidated into `recall/opencode/`         | **Pending** — Phase 5j                                                             |
| `bun run typecheck` and `bun test` pass throughout            | Passing                                                                            |
