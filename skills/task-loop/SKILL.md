---
name: task-loop
description: Run one task-loop iteration toward GOAL.md
license: MIT
compatibility: opencode
metadata:
  trigger: manual_user_request
  priority: '850'
  requires_state: 'writable'
  min_version: '0.1.0'
---

# Task Loop Skill

## Purpose

Run exactly one focused iteration toward `GOAL.md`, using `continuum task` as the execution ledger, then stop.

## Entry Point (Re-focuser)

`GOAL.md` at repo root is the north star. Read it at the start of every loop and produce a one-line alignment statement.
If a NOW memory file exists, read the latest entry to avoid duplicating work, but use task priority (lower number = higher priority) as the source of truth for what to resume; createdAt is only a tie-breaker.
If you resume from NOW, verify the task intent explicitly cites a GOAL.md section and update it before proceeding.
Treat `open` as the default working queue because `task create` defaults to `open`.
Priority ordering: lower numbers are higher priority (default is 100).

## Preconditions

- `GOAL.md` exists at repo root
- Continuum task DB initialized (`bun run bin/continuum task init`)

If either is missing, stop and ask the user to fix it.

## Single-Iteration Loop (Hard Stop After One Step)

1. Read `GOAL.md` and write a one-line alignment statement.
2. Select a task (avoid creating duplicates; prefer `open`, ordered by priority):
   - If a `task_id` was provided, use it.
   - Else list `open` tasks sorted by priority (lowest number first; createdAt only breaks ties) and select the first that references GOAL.md Current focus.
   - If the latest NOW task is still `open` or `ready` and has a priority number less than or equal to the selected task, resume it.
   - Else choose the highest-priority `ready` task that references GOAL.md Current focus (only if your workflow explicitly uses `ready`).
   - If no matching `open` or `ready` task exists, create one from `GOAL.md` (use a Current focus bullet as the title) and assign a priority.
   - If an `investigation` task exists for the same focus, ensure it has a lower priority number than build tasks and select it first.
   - Never create a new task if an existing `open`/`ready` task already has the same intent/title.
3. Ensure task intent references a section of `GOAL.md` and add a minimal plan if missing (update the task before validation).
4. Pick the first `pending` step.
   - If no steps exist, add 1-3 concrete steps derived from Current focus (avoid “run the loop” phrasing).
5. Mark the step `in_progress`.
6. Do the work (code, docs, config) that completes the step.
7. Validate (one command at a time, they don't `&&` well):
   - Run `bun run typecheck`
   - Run `bun test`
   - Run one smoke command relevant to the work (example: `bun run bin/continuum task list --json`)
8. Add notes (discovery/decision) to the task as needed.
9. Complete the step with a concise summary.
10. If all steps are complete, validate and complete the task.
11. Append a brief entry via `continuum memory append agent "..."` (auto-starts a session if missing).
12. Stop and return control to the user.

## Commands (Reference)

List open tasks (default queue, priority-ordered):

```bash
bun run bin/continuum task list --status open --sort priority --order asc --limit 20
```

List ready tasks (optional queue):

```bash
bun run bin/continuum task list --status ready --sort priority --order asc --limit 1
```

Get task details:

```bash
bun run bin/continuum task get <task_id>
```

Create task from goal (leave status as default unless you explicitly use a ready queue):

```bash
bun run bin/continuum task create --title "<Current focus>" --type feature --priority 100 --intent "Aligned to GOAL.md: <section>" --description "@GOAL.md" --plan "Plan: <1-3 steps>"
```

List steps:

```bash
bun run bin/continuum task steps list <task_id>
```

Add steps:

```bash
bun run bin/continuum task steps add <task_id> --steps @steps.json
```

Add or update plan:

```bash
bun run bin/continuum task update <task_id> --plan "Plan: <1-3 steps>"
```

Mark in progress:

```bash
bun run bin/continuum task steps update <task_id> <step_id> --status in_progress
```

Complete step:

```bash
bun run bin/continuum task steps complete <task_id> --step-id <step_id> --notes "Done"
```

Add note:

```bash
bun run bin/continuum task note add <task_id> --kind discovery --content "@notes.md" --source agent
```

Validate and complete task:

```bash
bun run bin/continuum task validate <task_id> --transition completed
bun run bin/continuum task complete <task_id> --outcome @outcome.md
```

## NOW Memory Entry (Minimum)

Append a short entry via CLI (auto-starts a NOW session if missing):

```bash
continuum memory append agent "Goal alignment: ...; Task: ...; Step: ...; Changes: ...; Tests: ...; Outcome: ..."
```

Include:

- Goal alignment: one-line summary
- Task: `<task_id>`
- Step: `<step_id>`
- Changes: file paths touched
- Tests: commands run and results
- Outcome: one sentence

Do not include secrets or credentials.

## Stop Conditions

- One step completed, OR
- Validation failed (log failure and stop), OR
- Blocked by missing info (log and stop)
