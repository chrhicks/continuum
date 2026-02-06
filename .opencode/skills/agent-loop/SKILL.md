---
name: agent-loop
description: Run a batch task loop with memory consolidation
license: MIT
compatibility: opencode
metadata:
  trigger: manual_user_request
  priority: '900'
  requires_state: 'writable,no_active_agent'
  min_version: '0.1.0'
---

# Agent Loop Skill

## Purpose

Run a deterministic, batch-based task loop that:

1. selects the next task, 2) completes work + QA, 3) consolidates memory, 4) restarts with fresh context.

This skill is triggered by a loop request file created via:

- `bun run bin/continuum loop -n <count>`
- `bun run bin/continuum memory loop -n <count>`

## Inputs

### Loop request

Read: `.continuum/loop/request.json`

Expected fields:

- `count` (integer)
- `selection_rule`
- `qa_policy`
- `resume_behavior`

If the file is known by path, use a direct read rather than globbing (glob may skip dot-directories).
After loading the request, delete the file to avoid reprocessing.

## Task Selection Rule (Locked)

Pick the **highest priority**, then **oldest created** task in a **ready/open** state.

If priority or created time is missing:

- Default priority to "medium"
- Default created time to now (least preferred)

## Tools

### Continuum Task Plugin

Use the task plugin to list, view, and update tasks. Preferred operations:

- List tasks: status=open/ready
- View task details: priority, created_at, description
- Update task status and append notes

If the task plugin exposes CLI-only commands, use `/home/chicks/.local/bin/continuum` for list/view.

### Memory CLI

Use the local memory CLI for session lifecycle:

- `bun run bin/continuum memory session start`
- `bun run bin/continuum memory session end`
- `bun run bin/continuum memory consolidate`

## Loop Steps (Per Task)

1. **Bootstrap**
   - Read `.continuum/memory/RECENT.md` and `.continuum/memory/MEMORY.md` if they exist.
   - Select the next task using the rule above.

2. **Start Session**
   - Run `bun run bin/continuum memory session start`.
   - Append a 1-3 step plan to NOW using `@decision` markers.

3. **Work**
   - Implement the task.
   - Log markers during the work:
     - `@decision: ...`
     - `@discovery: ...`
     - `@pattern: ...`
   - Ensure at least one marker is recorded per task and avoid placeholder text.

4. **QA (Locked Policy)**
   - Always run `bun test`.
   - If the task description contains QA steps, run those too.
   - If no QA steps are provided, run a minimal smoke test relevant to the change.
     - Example smoke checks: `bun run bin/continuum --help` or `bun run bin/continuum memory status`.

5. **Finalize**
   - If successful: mark the task completed and add a short summary to the task description.
   - If blocked: mark the task blocked and append an **Unblock Plan** (1-3 steps).
   - If no markers were recorded, append a brief `@decision` summary before ending the session.
   - End the session and consolidate:
     - `bun run bin/continuum memory session end`
     - `bun run bin/continuum memory consolidate`

6. **Repeat**
   - Continue until the request `count` is satisfied or no ready tasks remain.

7. **Plan Next Work (On Exit)**
   - When the loop completes a batch or finds no ready tasks, plan next work by reviewing current docs and code.
   - Read `.continuum/memory/RECENT.md` and `.continuum/memory/MEMORY.md` for context.
   - Inspect relevant documentation and code paths to identify 3-5 highest priority gaps or improvements.
   - Scan open tasks to avoid duplicates; only create missing tasks.
   - Create each task in Continuum with a clear title, intent, description, and 1-3 step plan, including priority.
   - If 3-5 suitable tasks already exist, do not create new ones; note this in NOW with an `@decision` marker.

## Exit Conditions

- No ready/open tasks available
- Reached the requested count

## Notes

- Do not retry failed tasks in the same batch.
- The next iteration may resume a blocked task if it becomes the top candidate.
