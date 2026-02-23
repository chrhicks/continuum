# Goal

## Outcome (one sentence)

Continuum's recall and memory workflows reliably capture, consolidate, and retrieve project context across sessions with deterministic artifacts and usable CLI defaults.

## Why it matters

If recall is reliable and memory is easy to manage, sessions resume quickly without manual log scanning or ad-hoc context reconstruction.

## Success criteria

- `memory` CLI auto-starts or resumes on append, and `memory status` falls back to the latest NOW file.
- Memory consolidation writes stable NOW/RECENT/MEMORY artifacts with consistent structure and an audit log.
- Recall import can ingest `.continuum/recall/opencode` outputs using deterministic index/diff/plan/ledger artifacts.
- `recall` defaults to BM25 and falls back to semantic when needed, with explicit mode reporting and no auto-embedding.
- Summaries include a deterministic keyword/alias block to improve BM25 hit rate.
- Recall quality is validated with the qmd evaluation harness.

## Constraints

- One focused step per session; stop after completion or block.
- Use `continuum task` as the single source of truth for work state.
- Do not log secrets or credentials.
- No automatic model or embedding downloads; local-only workflows.
- Keep outputs ASCII unless existing context requires otherwise.

## Non-goals

- Replace tasks, git history, or configs as canonical source of truth.
- Fully autonomous multi-step execution without user sessions.
- Cross-repo or multi-project memory sharing.

## Current focus (next 1-3 iterations)

- Implement BM25 to semantic fallback for recall lookup with clear flags and mode reporting.
- Enrich recall summaries with deterministic keywords and re-run qmd eval.
- Upgrade memory CLI: auto-start/resume, status fallback, list/summary, and recall import flow.
- Draft the memory CLI roadmap from recall analysis and map to concrete tests.
