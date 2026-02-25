# Goal

## Outcome (one sentence)

Continuum's memory system is complete, reliable, and actively used by agents: session data flows automatically into memory, memory informs task decisions, and task discoveries and decisions flow back into memory.

## Why it matters

Memory is only valuable if it is written to consistently, accurate when read, and connected to the work being done. Right now the memory system is half-built and siloed from tasks, so context is lost between sessions and agents make decisions without history.

## Success criteria

- NOW file is fully cleared (body wiped, header preserved) after successful consolidation, atomically and without data loss.
- `memory search` supports `--after <date>` to scope queries to a time window.
- An agent following the task-loop skill automatically appends a memory entry (via `continuum memory append`) at the start and end of each task step, without being explicitly prompted.
- When a task step is completed, any discoveries or decisions recorded on that task are also appended to the active NOW file.
- When an agent selects a task to work on, it first runs `continuum memory search <task-title>` and incorporates relevant results into its plan.
- `continuum task init` is removed or aliased to `continuum init` to eliminate the duplicate entry point.

## Constraints

- One focused step per session; stop after completion or block.
- Use `continuum task` as the single source of truth for work state.
- Memory writes must be atomic; no partial writes on failure.
- Do not log secrets or credentials.
- No automatic model or embedding downloads; local-only workflows.
- Keep outputs ASCII unless existing context requires otherwise.

## Non-goals

- Full programmatic task loop implementation (moving skill logic into `src/loop/`).
- LLM-based consolidation improvements.
- Recall system changes (OpenCode session import pipeline).
- Multi-repo or cross-project task orchestration.
- Long-running autonomous loops without user control.
