# Goal

## Outcome (one sentence)

Continuum provides an agent friendly task loop that keeps me productive by turning GOAL.md focus into a live, prioritized task queue with memory logging and QA for each step.

## Why it matters

I work best when the next task is obvious and context is durable, so a reliable loop prevents drift, makes progress measurable, and leaves a memory trail for the next session.

## Success criteria

- A task seeding flow builds or updates `continuum task` items from GOAL.md Current focus without duplicates.
- The loop always selects the highest priority open task aligned to GOAL.md and resumes it if a NOW session exists.
- Each completed step records a concise memory append entry with goal alignment, task and step IDs, files, and tests run.
- QA policy is enforced (`bun run typecheck`, `bun test`, plus a relevant smoke command) and failures are recorded on the task.
- Loop requests are stable artifacts in `.continuum/loop/` and include selection and QA metadata.

## Constraints

- One focused step per session; stop after completion or block.
- Use `continuum task` as the single source of truth for work state.
- Do not log secrets or credentials.
- No automatic model or embedding downloads; local-only workflows.
- Keep outputs ASCII unless existing context requires otherwise.

## Non-goals

- Multi-repo or cross-project task orchestration.
- Long-running autonomous loops without user control.
- Replacing existing memory or recall tiers or task history as canonical sources.

## Current focus (next 1-3 iterations)

- Add a GOAL to task seeding command or script to populate open tasks when the queue is empty.
- Tighten task loop alignment: ensure tasks include intent and plan that cite GOAL sections and auto-generate 1-3 steps.
- Improve loop reporting: capture last run summary in `.continuum/loop/` and surface it in CLI output.
