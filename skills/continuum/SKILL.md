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

## Start

Call `continuum_summary` at the beginning of a session for the current task and
memory briefing. Call `continuum_init` only when the workspace has not been
initialized.

## Tasks

Use `continuum_task_*`, `continuum_task_step_*`, and `continuum_task_note_add`
to track work that benefits from persistence across sessions.

- Inspect existing tasks before creating one to avoid duplicates.
- Use lower priority numbers for more important work.
- Add executable steps when a task needs an explicit plan.
- Record durable discoveries and decisions as task notes.
- Validate a transition before marking a task ready or completed.
- Complete tasks with a concise outcome.
- Delete a task only when explicitly requested.

Do not force every small request into a task or impose a fixed execution loop.
The user's current request and the repository's own instructions determine the
workflow.

## Memory

Use `continuum_memory_search` when prior decisions, failures, or implementation
context could affect the work. Use `continuum_memory_append` for context worth
retaining beyond the current session, not routine progress narration.

Use `continuum_memory_consolidate` to turn pending journal entries into derived
memory. Journal entries and imported recall messages are immutable evidence;
consolidations and recall summaries are derived evidence.

Recall is an explicit OpenCode import:

- Use `continuum_recall_status` to inspect availability.
- Run `continuum_recall_import` with `dryRun: true` before importing when scope
  or volume is uncertain.
- Import only when requested or when recovering relevant prior session context.

Do not include secrets or credentials in tasks or memory.

## Fallback

The `continuum` CLI remains available for humans, scripting, recovery, and when
MCP is unavailable. Run `continuum guide` for its current command reference.
