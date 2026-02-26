# Goal Roadmap: Code Quality Refactoring

Execution plan for the goal in `GOAL.md`. Four phases, ordered by risk and dependency. Each phase leaves `bun test` and `bun run typecheck` passing.

---

## Phase 1: Eliminate Duplication

Four independent changes — no inter-dependencies, any order, all low-risk. Each is a pure addition (new helper) followed by replacement of usage sites. No logic changes.

---

### 1a. Consolidate step-status marker logic

**What:** The mapping of a step's status to a display marker (`[x]`, `[>]`, `[~]`, `[ ]`) appears three times in `src/cli/commands/task.ts` with minor variations (lines 691–697, 1149–1156, 1212–1216). Extract a single shared helper.

**Files to change:**

- `src/cli/commands/task.ts`
  - Add helper (near line 1000, with other render utilities):
    ```ts
    function formatStepMarker(status: TaskStepStatus): string {
      if (status === 'completed') return '[x]'
      if (status === 'in_progress') return '[>]'
      if (status === 'skipped') return '[~]'
      return '[ ]'
    }
    ```
  - Replace the three inline marker blocks at lines 691–697, 1149–1156, 1212–1216 with calls to `formatStepMarker(step.status)`.
  - The `formatTaskCompact` variant at line 1212–1216 uses single-char markers (`x`, `>`, `~`, `.`) — preserve this by adding a second parameter: `formatStepMarker(status, { compact: true })` returning the single-char form.

**Verification:** `bun test` passes; `grep -n 'status.*completed.*x\|in_progress.*>' src/cli/commands/task.ts` returns no inline marker logic.

---

### 1b. Consolidate parse-positive-integer pattern

**What:** In `src/cli/commands/memory.ts`, the pattern "parse a string as a positive integer, throw if invalid" appears four times as separate named functions (lines 1042–1083): `parseRecallLimit`, `parseDiffLimit`, `parseSyncLimit`, `parseTail`. A fifth instance, `parseLimit`, also exists in `src/cli/commands/task.ts:909`. Extract a single shared utility.

**Files to change:**

- `src/cli/io.ts`
  - Add a shared `parsePositiveInt(value: string | undefined, label: string, allowNull?: false): number` overload that consolidates the shared body. Signature:
    ```ts
    export function parsePositiveInt(
      value: string | undefined,
      label: string,
    ): number
    ```
  - Throw `new Error(\`${label} must be a positive integer\`)` on invalid input.
  - A nullable variant (used by `parseSyncLimit`) can be: if `value` is undefined/empty return `Infinity` (or the caller handles it).

- `src/cli/commands/memory.ts`
  - Delete `parseRecallLimit`, `parseDiffLimit`, `parseSyncLimit`, `parseTail` (lines 1042–1083).
  - Replace all four call sites with `parsePositiveInt(value, '<label>')`.

- `src/cli/commands/task.ts`
  - Replace `parseLimit` (lines 909–923) with an import of `parsePositiveInt` from `../io`.

**Verification:** `bun test` passes; `grep -n 'function parse.*Limit\|function parseTail' src/` returns nothing.

---

### 1c. Consolidate resolve-recall-path helpers

**What:** In `src/cli/commands/memory.ts` lines 1094–1120, four functions (`resolveDiffReportPath`, `resolveSyncPlanPath`, `resolveSyncLedgerPath`, `resolveSyncLogPath`) share the identical body — they differ only in their fallback filename. Replace with one generic helper.

**Files to change:**

- `src/cli/commands/memory.ts`
  - Delete the four functions at lines 1094–1120 (27 lines total).
  - Add a single helper in their place:
    ```ts
    function resolveRecallPath(
      dataRoot: string,
      value: string | null | undefined,
      filename: string,
    ): string {
      if (value) return resolve(process.cwd(), value)
      return join(dataRoot, 'recall', 'opencode', filename)
    }
    ```
  - Update the four call sites (inside `handleRecallDiff` and `handleRecallSync`) to use `resolveRecallPath(dataRoot, options.report, 'diff-report.json')` etc.

**Verification:** `bun test` passes; four old function names no longer appear in the file.

---

### 1d. Extract parent-exists validation helper

**What:** `create_task` (lines 212–228) and `update_task` (lines 280–301) in `src/task/tasks.repository.ts` contain the identical block that validates a parent task exists before writing. Extract it.

**Files to change:**

- `src/task/tasks.repository.ts`
  - Add a private async helper after the imports:
    ```ts
    async function validate_parent_exists(
      db: Database,
      parent_id: string,
    ): Promise<void> {
      const exists = await task_exists(db, parent_id)
      if (!exists) {
        throw new ContinuumError('PARENT_NOT_FOUND', 'Parent task not found', {
          parent_id,
        })
      }
    }
    ```
  - Replace the two duplicated blocks (lines 212–228 in `create_task`, lines 280–301 in `update_task`) with `await validate_parent_exists(db, input.parent_id)`.

**Verification:** `bun test` passes; `PARENT_NOT_FOUND` error cases in the test suite still pass.

---

## Phase 2: Extract Structural Clones

Two changes. Independent of each other, can run in any order. Both reduce duplication in the larger domain files.

---

### 2a. Shared `buildSummaryLines` helper in consolidate.ts

**What:** `buildRecentEntry` (lines 203–257) and `buildMemorySection` (lines 324–378) in `src/memory/consolidate.ts` are structural clones — same field ordering, same conditional push pattern, same `items.map(i => \`- ${i}\`)`mapping. The only differences are the header format and an extra`files`field in`buildMemorySection`.

**Files to change:**

- `src/memory/consolidate.ts`
  - Extract a shared helper:
    ```ts
    function buildSummaryLines(
      summary: ConsolidationSummary,
      header: string,
      includeFiles: boolean,
    ): string[] {
      const lines: string[] = [header, '']
      if (summary.narrative) lines.push(summary.narrative, '')
      if (summary.decisions?.length) { ... }
      if (summary.discoveries?.length) { ... }
      // ... same pattern for each field
      if (includeFiles && summary.files?.length) { ... }
      return lines
    }
    ```
  - Rewrite `buildRecentEntry` as: `return buildSummaryLines(summary, header, false).join('\n')`
  - Rewrite `buildMemorySection` as: `return buildSummaryLines(summary, header, true).join('\n')`
  - Both original functions keep their signatures — callers do not change.

**Verification:** `bun test` passes; existing consolidation tests cover the output format.

---

### 2b. Generic collection-patch helper in tasks.repository.ts

**What:** Inside `update_task` (lines 262–550 in `src/task/tasks.repository.ts`), the delete/update/add pattern for steps (lines 326–407), discoveries (lines 409–469), and decisions (lines 472–533) is structurally identical. All three spread existing items, process `.delete` using a `Set`, process `.update` by `findIndex` + splice, and process `.add` by computing the next ID + appending.

**Files to change:**

- `src/task/tasks.repository.ts`
  - Extract a generic helper (typed with a generic `T extends { id: string }`):
    ```ts
    function patch_collection<T extends { id: string }>(
      existing: T[],
      patch: CollectionPatch<Omit<T, 'id'>, Partial<Omit<T, 'id'>>> | undefined,
      make_id: (index: number) => string,
      apply_update: (item: T, update: Partial<Omit<T, 'id'>>) => T,
    ): T[]
    ```
  - `patch_collection` handles delete, update, and add in sequence, returning the new array.
  - Replace the three inline blocks in `update_task` with three calls to `patch_collection`.
  - Note: each collection uses a different ID prefix (`step-`, `disc-`, `dec-`) — pass `make_id` as a parameter.

**Verification:** All `task update` tests pass, especially add/update/delete variants for steps, discoveries, and decisions.

---

## Phase 3: Type Safety

Two independent changes. Low risk — adding types, not changing logic. Can be done alongside or after Phases 1–2.

---

### 3a. Remove `as any` casts in task.ts

**What:** Two `as any` casts in `src/cli/commands/task.ts` (lines 366 and 624) bypass the type system when building an update payload. Both stem from building a `Record<string, unknown>` object and casting to `SdkUpdateTaskInput`.

**Root cause:** `map_update_input` in `src/sdk/index.ts:128` has an inferred return type. The CLI builds a partial update object and passes it `as any` to avoid a type error from the loose inferred type.

**Files to change:**

- `src/sdk/index.ts`
  - Add explicit return type to `map_update_input`:
    ```ts
    function map_update_input(input: SdkUpdateTaskInput): UpdateTaskInput { ... }
    ```
  - This propagates the correct type through `continuum.task.update(id, input)`.

- `src/cli/commands/task.ts`
  - At lines 366 and 624, replace `update as any` with a properly typed object. Build `update` as `SdkUpdateTaskInput` from the start by using the correct typed fields (title, type, status, etc.) directly instead of a `Record<string, unknown>`.
  - Import `SdkUpdateTaskInput` (or the equivalent type) from the SDK types.

**Verification:** `grep -r 'as any' src/` returns nothing. `bun run typecheck` passes.

---

### 3b. Explicit return types on exported functions

**What:** Several exported and module-level functions are missing explicit return type annotations.

**Files to change:**

- `src/sdk/index.ts`
  - Add `): CreateTaskInput` return type to `map_create_input` (line ~114).
  - Add `): UpdateTaskInput` return type to `map_update_input` (line ~128) — done in 3a, included here for completeness.
  - Add `): SdkTask` return type to `map_task` (line ~57).
  - Add `): SdkStep` return type to `map_step`.
  - Add `): SdkNote` return type to `map_note`.

- `src/task/validation.ts`
  - Add `): void` return type to `validate_blocker_list` (line ~50).

- `src/task/util.ts`
  - Add `): Promise<void>` return type to `init_project` (line ~42).

**Verification:** `bun run typecheck` passes. No new type errors introduced.

---

## Phase 4: Decompose Monolith Files

The four largest files each need to be split. Ordered from least to most invasive within the phase; complete each file fully before starting the next.

**Prerequisite:** Phases 1–3 complete (so duplication and type issues are resolved before restructuring).

---

### 4a. Split `src/cli/commands/task.ts` (1251 lines → directory)

**Target structure:**

```
src/cli/commands/task/
  index.ts       # createTaskCommand: parent Command + addCommand calls only (~40 lines)
  parse.ts       # all input parsing utilities (~170 lines)
  render.ts      # all rendering / formatting utilities (~240 lines)
  crud.ts        # list, get, create, update, complete, delete, validate, graph handlers (~400 lines)
  steps.ts       # steps sub-command handlers (~200 lines)
  notes.ts       # note add + notes flush handlers (~120 lines)
```

**Steps:**

1. Create `src/cli/commands/task/` directory.
2. Move parsing functions (`parseTaskStatus`, `parseTaskType`, `parseNoteKind`, `parseExpandOptions`, `parseLimit`/`parsePositiveInt`, `parseTaskId`, `parseIdList`) to `parse.ts`. Export all.
3. Move rendering functions (`renderTaskList`, `renderTaskTree`, `renderTaskDetails`, `formatTaskCompact`, `renderNextSteps`, `formatStepMarker`) to `render.ts`. Export all.
4. Extract each sub-command group into its own file. Each sub-command registration function receives the parent `Command` as its argument:
   - `crud.ts` exports `registerCrudCommands(taskCommand: Command): void` — registers list, get, create, update, complete, delete, validate, graph.
   - `steps.ts` exports `registerStepsCommands(taskCommand: Command): void`.
   - `notes.ts` exports `registerNotesCommands(taskCommand: Command): void`.
5. `index.ts` creates the `taskCommand` parent, calls the four `register*` functions, and exports `createTaskCommand`. This file should be under 50 lines.
6. Delete the original `src/cli/commands/task.ts`.
7. Verify `src/cli.ts` import of `./cli/commands/task` still resolves (it will, via `index.ts`).

**Verification:** `bun test` passes; `bun run bin/continuum task list --json` works; `bun run bin/continuum task create --title test --type chore` works.

---

### 4b. Split `src/cli/commands/memory.ts` (1173 lines → directory)

**Target structure:**

```
src/cli/commands/memory/
  index.ts       # createMemoryCommand: parent + addCommand calls only (~50 lines)
  handlers.ts    # memory domain handlers: status, list, consolidate, search, validate, log, recover, append (~400 lines)
  recall.ts      # all recall handlers + recall-specific utilities (~450 lines)
```

**Steps:**

1. Create `src/cli/commands/memory/` directory.
2. Move the five recall handler functions (`handleRecallImport`, `handleRecallIndex`, `handleRecallDiff`, `handleRecallSync`, `handleRecallSearch`) and their helpers (`resolveRecallPath` from phase 1c, `writeJsonFile`, `appendJsonLine`, `resolveDiffReportPath` etc.) to `recall.ts`. This file also registers all `recall` sub-commands via `registerRecallCommands(memoryCommand: Command): void`.
3. Move the eight memory domain handlers (`handleStatus`, `handleList`, `handleConsolidate`, `handleSearch`, `handleValidate`, `handleLog`, `handleRecover`, `handleAppend`) plus their utilities (`formatBytes`, `formatAgeMinutes`, `formatScore`) to `handlers.ts`.
4. `index.ts` creates the `memoryCommand` parent, calls `registerMemoryHandlers(memoryCommand)` and `registerRecallCommands(memoryCommand)`, and exports `createMemoryCommand`.
5. Delete the original `src/cli/commands/memory.ts`.
6. Verify the import in `src/cli.ts` still resolves.

**Verification:** `bun test` passes; `bun run bin/continuum memory status` works; `bun run bin/continuum memory recall diff --help` works.

---

### 4c. Split `src/task/tasks.repository.ts` (962 lines → multiple files)

**Target structure:**

```
src/task/
  tasks.repository.ts     # core task CRUD: create, get, list, complete, delete, exists (~300 lines)
  steps.repository.ts     # step operations: add_steps, update_step, complete_step, list_steps (~250 lines)
  notes.repository.ts     # discovery + decision operations (~200 lines)
  collection-patch.ts     # generic patch_collection helper (from phase 2b) (~60 lines)
```

**Steps:**

1. Extract `patch_collection` helper (phase 2b) to `collection-patch.ts` first.
2. Move step-specific functions (`add_steps`, `update_step`, `complete_step`, list_steps) to `steps.repository.ts`. These functions receive `db` and `task_id` as parameters, same as the originals.
3. Move discovery/decision functions to `notes.repository.ts`.
4. `tasks.repository.ts` retains `create_task`, `get_task`, `list_tasks`, `complete_task`, `delete_task`, `task_exists`, `update_task` (now much smaller after phase 2b + step/note extraction).
5. Update `src/task/tasks.service.ts` imports accordingly.

**Verification:** `bun test` passes; all existing repository-level tests pass.

---

### 4d. Split `src/memory/consolidate.ts` (840 lines → multiple files)

**Target structure:**

```
src/memory/
  consolidate.ts          # orchestration: consolidateNow, runConsolidation (~200 lines)
  consolidate-build.ts    # entry builders: buildRecentEntry, buildMemorySection, buildSummaryLines, summarizeForTier (~250 lines)
  consolidate-index.ts    # index operations: upsertMemoryIndex, buildDefaultIndexContent, insertEntryInSection, dedupeIndexEntries (~200 lines)
  consolidate-write.ts    # atomic write: writeFilesAtomically, backup helpers (~120 lines)
```

**Steps:**

1. Move `writeFilesAtomically` and its backup helpers to `consolidate-write.ts`.
2. Move `upsertMemoryIndex`, `buildDefaultIndexContent`, `insertEntryInSection`, `dedupeIndexEntries` to `consolidate-index.ts`.
3. Move `buildRecentEntry`, `buildMemorySection`, `buildSummaryLines` (from phase 2a), and any other entry-building helpers to `consolidate-build.ts`.
4. `consolidate.ts` retains `consolidateNow` and `runConsolidation` only, importing from the three new files.
5. Update callers: `src/memory/recover.ts` and `src/cli/commands/memory/handlers.ts` import from `consolidate.ts` (top-level function is unchanged).

**Verification:** `bun test` passes, particularly `tests/consolidate.test.ts`.

---

## Phase 5: Verify All Targets Met

After all phases complete, run a final check against every success criterion.

```bash
# No file over 300 lines
wc -l src/**/*.ts | sort -rn | head -20

# No function over 80 lines (manual review of any file still near 300 lines)

# Zero as any casts
grep -r 'as any' src/

# All exports have return types (typecheck catches missing annotations)
bun run typecheck

# All tests pass
bun test

# Smoke tests
bun run bin/continuum task list --json
bun run bin/continuum task create --title "smoke" --type chore --json
bun run bin/continuum memory status
```

---

## Execution Order

```
Phase 1a ─┐
Phase 1b ─┤
Phase 1c ─┼─ independent, any order
Phase 1d ─┘

Phase 2a ─┐
Phase 2b ─┘─ independent of each other, run after Phase 1

Phase 3a ─┐
Phase 3b ─┘─ independent, can run in parallel with Phase 2

Phase 4 ─── after Phases 1–3 (decomposition is easier on clean code)
  4a (task/) → 4b (memory/) → 4c (repository) → 4d (consolidate)

Phase 5 ─── final verification after all changes
```

---

## Success Criteria Check

| Criterion                                                           | Phase                                                |
| ------------------------------------------------------------------- | ---------------------------------------------------- |
| No file in `src/` exceeds 300 lines                                 | 4a–4d + verify in 5                                  |
| No function exceeds 80 lines                                        | 4a–4d (decompose large functions during file splits) |
| Zero `as any` casts                                                 | 3a                                                   |
| Exported functions have explicit return types                       | 3b                                                   |
| Step-status marker consolidated into `formatStepMarker`             | 1a                                                   |
| Parse-positive-int consolidated into `parsePositiveInt`             | 1b                                                   |
| `resolve*Path` consolidated into `resolveRecallPath`                | 1c                                                   |
| Parent-exists validation extracted into helper                      | 1d                                                   |
| `buildRecentEntry` / `buildMemorySection` share `buildSummaryLines` | 2a                                                   |
| Collection-patch logic extracted into `patch_collection`            | 2b                                                   |
| `createTaskCommand` decomposed into per-sub-command functions       | 4a                                                   |
| `bun run typecheck` and `bun test` pass throughout                  | all phases                                           |
