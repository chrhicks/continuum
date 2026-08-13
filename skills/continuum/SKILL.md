---
name: continuum
description: Use Continuum MCP for project tasks and durable memory
license: MIT
compatibility: opencode
metadata:
  trigger: manual_user_request
  priority: '900'
  requires_state: 'writable'
  min_version: '0.1.0'
---

# Continuum

Continuum provides a local task ledger and durable project memory. Use its
typed MCP tools through Executor. Every call requires the target repository's
absolute `workspace` path.

## Executor Setup

Resolve `workspace` to the absolute repository root, not the current nested
directory. Normal tools locate the initialized workspace above that path, but
`continuum_init` initializes the exact directory it receives.

Discover tools before calling them. Executor requires each connection's full
path, not a bare MCP name:

```ts
const { items } = await tools.search({
  namespace: 'continuum',
  query: 'workspace summary',
})
const summaryPath = items.find(
  (item) => item.name === 'continuum_summary',
)?.path
if (!summaryPath) return 'Continuum summary tool is unavailable.'
await tools.describe.tool({ path: summaryPath })
const result = await tools[summaryPath]({ workspace })
```

Tool paths commonly look like
`continuum.org.default.continuum_summary`, but always use the discovered path.

## Start

1. Call `continuum_summary` for the current task and memory briefing.
2. If it returns a not-initialized error, call `continuum_init` with the same
   repository-root `workspace`, then retry summary.
3. Use `continuum_task_list` and `continuum_task_get` to inspect relevant work
   before creating a task.

## Executor Results

Executor exposes each MCP response as `{ ok, data }`. The full typed result is
at `data.structuredContent`; `data.content` is only a compact status message.
For `!result.ok`, inspect or return `result.error`; do not read `data`.

Return `structuredContent` rather than the raw response or `data.content` when
reading several tools, so the same payload is not included twice and truncated:

```ts
const result = await tools[taskGetPath]({
  workspace,
  id,
})
return result.ok ? result.data.structuredContent : result.error
```

Batch only independent reads. For example, fetch independent task IDs in
parallel, then map each successful result to `data.structuredContent`. Sequence
dependent calls such as init then summary, create then add steps, and validate
then update or complete.

`valid: false`, nonempty `missingFields`, `openBlockers`, and consolidation
`status: 'conflict'` are successful tool responses that require follow-up, not
Executor failures.

## Tasks

Use `continuum_task_*`, `continuum_task_step_*`, and `continuum_task_note_add`
to track work that benefits from persistence across sessions.

- Inspect existing tasks before creating one to avoid duplicates.
- Use lower priority numbers for more important work.
- Add executable steps when a task needs an explicit plan.
- Record durable discoveries and decisions as task notes.
- Validate a transition before marking a task ready or completed. Only proceed
  when the returned `valid` is true.
- Complete tasks with a concise outcome.
- Delete a task only when explicitly requested.

Do not force every small request into a task or impose a fixed execution loop.
The user's current request and the repository's own instructions determine the
workflow.

Task notes remain attached to the task. For context that must be searchable
across tasks or sessions, also use `continuum_memory_append` and include the
task ID in its tags when useful.

## Memory

Use `continuum_memory_search` when prior decisions, failures, or implementation
context could affect the work. Use `continuum_memory_append` for context worth
retaining beyond the current session, not routine progress narration.

Use `continuum_memory_consolidate` to turn pending journal entries into derived
memory. Use `dryRun: true` first when its scope or cost is uncertain. Journal
entries and imported recall messages are immutable evidence; consolidations and
recall summaries are derived evidence.

Recall is an explicit OpenCode import:

- Use `continuum_recall_status` to inspect availability.
- Run `continuum_recall_import` with `dryRun: true` before importing when scope
  or volume is uncertain.
- Import only when requested or when recovering relevant prior session context.

Do not include secrets or credentials in tasks or memory.

## Fallback

The `continuum` CLI remains available for humans, scripting, recovery, and when
MCP is unavailable. Preserve workspace selection with, for example,
`continuum --cwd <absolute-workspace> guide task`.
