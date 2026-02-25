# Goal Roadmap: Close the Memory Loop

Execution plan for the goal in `GOAL.md`. Three phases, ordered by dependency. Each phase includes the exact files, functions, and changes needed.

---

## Phase 1: Foundation Fixes

Three independent changes. No inter-dependencies; can be done in any order.

---

### 1a. Verify and harden NOW clearing after consolidation

**What:** After `continuum memory consolidate`, the NOW file body should be fully wiped (header preserved, body cleared). The logic exists but has no regression test and an edge-case gap.

**Files to change:**

- `src/memory/consolidate.ts`
  - `buildClearedNowContent` (line 602–614): builds cleared content — logic is present
  - `extractSessionHeader` (line 616–624): extracts `# Session: ` line from body; falls back to `# Session: unknown` if not found — the fallback is silent and wrong if a NOW file was created without this header. Add a branch that preserves the first `#` heading found (not just `# Session:`), or raise a warning when the fallback fires.
  - The cleared NOW is already included in the `writeFilesAtomically` call at line 161–171 — no change needed there.

- `tests/consolidate.test.ts` (new or extend existing):
  - Add a test: consolidate a NOW file that has a valid `# Session:` header → assert the resulting NOW body contains only that header line and a trailing blank line, no other content.
  - Add a test: consolidate a NOW file whose body has no `# Session:` header → assert fallback fires without data loss (frontmatter preserved, body is not `undefined`).
  - Add a test: consolidate twice on the same (already-cleared) NOW file → assert it is idempotent.

**Gotcha:** `skipNowCleanup` option (line 172) is passed in some call paths (e.g., `recover`). This skips cleanup of old NOW files but does NOT affect whether the active NOW is cleared. Verify this option does not accidentally suppress the clearing write.

---

### 1b. Add `--after <date>` to `memory search`

**What:** Add a date-range filter so agents can scope searches to recent sessions only.

**Files to change:**

- `src/memory/search.ts`
  - Extend `searchMemory` signature:
    ```ts
    export function searchMemory(
      query: string,
      tier: MemorySearchTier = 'all',
      tags: string[] = [],
      after?: Date,
    ): MemorySearchResult
    ```
  - Add a date filter step in the file loop (after line 34, before reading content). For each file:
    - If `after` is set and the file is a NOW file (`NOW-*.md`): parse the frontmatter `timestamp_start` field. If absent or unparseable, fall back to filesystem `statSync(filePath).mtimeMs`.
    - If `after` is set and the file is RECENT or MEMORY: use filesystem mtime (these files are continuously updated; frontmatter `consolidation_date` is also available on MEMORY files).
    - Skip the file entirely if its resolved date is before `after`.
  - Helper: `function resolveFileDate(filePath: string, content: string): Date` — parses frontmatter `timestamp_start` or `consolidation_date`, falls back to `statSync(filePath).mtime`.

- `src/cli/commands/memory.ts`
  - In the `memory search` command registration (line 337–352), add:
    ```ts
    .option('--after <date>', 'Only search files modified after this ISO date (e.g. 2026-02-01)')
    ```
  - In the options type and `handleSearch` call, parse the `--after` string into a `Date`:
    ```ts
    const after = options.after ? parseAfterDate(options.after) : undefined
    handleSearch(query, tier, tags, after)
    ```
  - Add `parseAfterDate(value: string): Date` helper — parse ISO date string; throw a clear error if invalid.
  - Update `handleSearch` signature to accept `after?: Date` and pass through to `searchMemory`.

- `src/sdk/index.ts`
  - Check whether `searchMemory` is exposed in the SDK. If it is, update the SDK wrapper to accept and pass through `after`. If it is not, no SDK change needed.

**Tests:** Add to `tests/memory-search.test.ts` (or existing search tests):

- Create two NOW files with different `timestamp_start` values. Search with `--after` set to a date between them. Assert only the newer file's content is returned.
- Test with an invalid `--after` value → assert a descriptive error is thrown.

---

### 1c. Remove `continuum task init` duplicate

**What:** `continuum task init` is an exact duplicate of `continuum init`. `task create` auto-initializes anyway. Remove it.

**Files to change:**

- `src/cli/commands/task.ts`
  - Delete lines 114–138 (the entire `.command('init')` block under `taskCommand`). This is 25 lines.
  - No other changes needed. The `continuum.task.init()` SDK method stays — it is used by `task create` for auto-init.

- No test changes needed. No existing test exercises `continuum task init` via CLI argv (confirmed). Direct SDK calls to `continuum.task.init()` in test setup are unaffected.

**Backward compat note:** Any script calling `continuum task init` will get `error: unknown command 'init'` after this change. The replacement is `continuum init`.

---

## Phase 2: Task → Memory Bridge

Depends on: nothing in Phase 1 (can run in parallel).

---

### 2a. Add `continuum task notes flush <task_id>`

**What:** A new CLI command that reads all discoveries and decisions from a task and appends each as a structured entry to the active NOW memory file. This is the plumbing required by Phase 3 step 13.

**Files to change:**

**`src/cli/commands/task.ts`**

Add a new `notesCommand` group after line 769 (`taskCommand.addCommand(noteCommand)`):

```ts
const notesCommand = new Command('notes').description(
  'Bulk task note operations',
)
notesCommand.action(() => {
  notesCommand.outputHelp()
})

notesCommand
  .command('flush')
  .description('Flush task discoveries and decisions to NOW memory')
  .argument('<task_id>', 'Task ID')
  .action(async (taskId: string, _options: unknown, command: Command) => {
    await runCommand(
      command,
      async () => {
        const task = await continuum.task.get(taskId)
        if (!task) throw new Error(`Task '${taskId}' not found.`)
        return { task }
      },
      async ({ task }) => {
        const total = task.discoveries.length + task.decisions.length
        if (total === 0) {
          console.log('No notes to flush.')
          return
        }
        // import appendAgentMessage at top of file
        for (const note of task.discoveries) {
          await appendAgentMessage(formatDiscovery(task.id, note), {
            tags: [task.id],
          })
        }
        for (const note of task.decisions) {
          await appendAgentMessage(formatDecision(task.id, note), {
            tags: [task.id],
          })
        }
        console.log(
          `Flushed ${task.discoveries.length} discovery(s) and ${task.decisions.length} decision(s) to NOW.`,
        )
      },
    )
  })

taskCommand.addCommand(notesCommand)
```

Add these two formatter helpers near the bottom of the file (alongside `renderTaskDetails`):

```ts
function formatDiscovery(
  taskId: string,
  note: { content: string; impact?: string | null },
): string {
  const lines = [`[Discovery from ${taskId}] ${note.content}`]
  if (note.impact) lines.push(`Impact: ${note.impact}`)
  return lines.join('\n')
}

function formatDecision(
  taskId: string,
  note: { content: string; rationale?: string | null; impact?: string | null },
): string {
  const lines = [`[Decision from ${taskId}] ${note.content}`]
  if (note.rationale) lines.push(`Rationale: ${note.rationale}`)
  if (note.impact) lines.push(`Impact: ${note.impact}`)
  return lines.join('\n')
}
```

Add import at the top of the file:

```ts
import { appendAgentMessage } from '../../memory/now-writer'
```

**`src/sdk/types.ts`** (optional but recommended for consistency):

Extend the `notes` namespace interface to document the flush path. The flush itself can be done entirely in the CLI (no new SDK method strictly required since `task.get()` already returns all notes inline at `task.discoveries` and `task.decisions`).

**Note on note shapes** (from codebase exploration):

- `task.discoveries: TaskDiscovery[]` — each has `id: string`, `content`, `source`, `impact: string | null`, `createdAt`; `rationale` is always `null`.
- `task.decisions: TaskDecision[]` — same shape but `rationale: string | null` is populated.
- Both are returned inline on every `task.get()` call; no separate query needed.

**Tests:**

Add to `tests/cli.test.ts` (after the existing task CLI tests, around line 593):

- `task notes flush appends all discoveries and decisions to NOW` — create task, add one discovery with impact and one decision with rationale, run flush, read NOW file, assert content includes `[Discovery from`, `[Decision from`, `Impact:`, `Rationale:`.
- `task notes flush with empty notes prints nothing-to-flush` — create task with no notes, run flush, assert output is "No notes to flush." and NOW file is not modified.
- `task notes flush with unknown task id returns error` — assert `ok: false` in JSON output.

---

## Phase 3: Skill Refinement

Depends on: Phase 2 (step 13 calls `task notes flush`). Phase 2 must ship first or the new step 13 must include a guard.

---

### 3a–c. Update task-loop skill with three new behaviors

**What:** Add memory search before planning, a step-start memory append, and a task-notes flush after step completion. These are all changes to a single Markdown file.

**File to change:** `.agents/skills/task-loop/SKILL.md`

**Replace the entire "Single-Iteration Loop" section** (lines 34–67) with the following. All other sections (Entry Point, Preconditions, Commands, NOW Memory Entry, Stop Conditions) are unchanged except for the one-sentence addition noted below.

````markdown
## Single-Iteration Loop (Hard Stop After One Step)

1. Read `GOAL.md` and write a one-line alignment statement.
2. Search memory for prior context on this goal area:
   ```bash
   bun run bin/continuum memory search "<GOAL keyword or active task title>"
   ```
````

Note any prior task IDs, known failures, or decisions for this area. Proceed regardless of results. 3. Preflight to avoid redundant work:

- List `open` tasks.
- If the list is empty, create one `investigation` task focused on discovering GOAL-aligned work in the current repo. This task should explicitly state the exploration criteria and expected outputs (new concrete tasks with priorities and evidence).
- For the top priority open task, quickly check whether existing code/tests/docs already implement it.
- If already implemented, add a discovery note and skip to the next task.
- If all open tasks appear already implemented, complete them with notes and stop.

4. Select a task (avoid creating duplicates; prefer `open`, ordered by priority):
   - If a `task_id` was provided, use it.
   - Else list `open` tasks sorted by priority (lowest number first; createdAt only breaks ties) and select the top task.
   - If the latest NOW task is still `open` or `ready` and has a priority number less than or equal to the selected task, resume it.
   - Else choose the highest-priority `ready` task (only if your workflow explicitly uses `ready`).
   - If no `open` or `ready` tasks exist, create one `investigation` task from `GOAL.md` and assign it a high priority (lower number than build work for the same focus).
   - If an `investigation` task exists for the same focus, ensure it has a lower priority number than build tasks and select it first.
   - Never create a new task if an existing `open`/`ready` task already has the same intent/title.
5. Ensure task intent references a section of `GOAL.md` and add a minimal plan if missing (update the task before validation).
6. Pick the first `pending` step.
   - If no steps exist, add 1-3 concrete steps derived from GOAL.md success criteria (avoid "run the loop" phrasing).
7. Append a step-start memory entry (run before beginning work):
   ```bash
   bun run bin/continuum memory append agent "Task: <task_id>; Step: <step_id>; Status: starting; Intent: <one-line step goal>"
   ```
8. Mark the step `in_progress`.
9. Do the work (code, docs, config) that completes the step.
   - If the selected task is `investigation`, perform a focused repo exploration and create 1-5 concrete follow-up tasks directly in `continuum task`.
   - Every generated task must include GOAL alignment, a concise plan, and evidence (code/test/doc reference) so it is actionable.
   - De-duplicate against existing `open`/`ready`/`in_progress`/`completed` tasks before creating anything new.
10. Validate (one command at a time, they don't `&&` well):
    - Run `bun run typecheck`
    - Run `bun test`
    - Run one smoke command relevant to the work (example: `bun run bin/continuum task list --json`)
11. Add notes (discovery/decision) to the task as needed.
12. Complete the step with a concise summary.
13. Flush task notes to NOW memory:
    ```bash
    bun run bin/continuum task notes flush <task_id>
    ```
    Skip this step if Phase 2 has not shipped yet (`task notes flush` command does not exist).
14. If all steps are complete, validate and complete the task.
15. Append the full loop-end memory entry (auto-starts a session if missing):
    ```bash
    bun run bin/continuum memory append agent "..."
    ```
16. Stop and return control to the user.

```

**Also update the "NOW Memory Entry" section** — add one sentence after the opening line (after "Append a short entry via CLI (auto-starts a NOW session if missing):"):

> Run a shorter version (Task, Step, Status, Intent only) at step 7 (start); run the full version at step 15 (end).

**Design notes:**
- Two memory writes per loop: step 7 (lightweight, intent capture) and step 15 (full summary). No redundancy.
- `memory append` auto-starts a NOW session if none exists — no manual `session start` needed.
- Step 2 (memory search) is read-only context enrichment — it informs deduplication in steps 3–4, surfacing prior completed tasks and known failures before any new task creation.
- Step 13 (notes flush) writes verbatim task notes to NOW. The step-15 summary should therefore omit or condense the Discoveries field to avoid duplication.

---

## Execution Order

```

Phase 1a ─┐
Phase 1b ─┼─ independent, any order
Phase 1c ─┘

Phase 2a ─── can run in parallel with Phase 1

Phase 3 ─── after Phase 2 ships (step 13 depends on `task notes flush`)

```

## Success Criteria Check

| Criterion | Phase |
|-----------|-------|
| NOW file fully cleared after consolidation, with regression test | 1a |
| `memory search --after <date>` works | 1b |
| `continuum task init` removed | 1c |
| `continuum task notes flush` command exists | 2a |
| Agent appends memory at start and end of each step | 3 (step 7 + step 15) |
| Task notes flow to NOW after step completion | 3 (step 13) |
| Agent runs memory search before planning | 3 (step 2) |
```
