# Memory CLI Roadmap (Recall Analysis Translation)

## Alignment

GOAL.md Current focus: upgrade the memory CLI and recall import flow with deterministic, local-only recall artifacts that are easy to validate.

## Sources

- RECALL-ANALYSIS.md
- docs/context-recall-notes.md

## Roadmap Sections

### 1) Recall import foundation (OpenCode storage -> recall artifacts)

Outcomes:

- Deterministic session selection scoped to the current repo.
- Stable per-session recall documents written to `.continuum/recall/opencode/`.
- Minimal, inspectable metadata per artifact (session/project ids, timestamps, counts).

Concrete mapping:

- CLI: add `continuum memory recall import` (defaults to current repo project; flags for `--db`, `--project`, `--session`, `--out`).
- Data: `.continuum/recall/opencode/OPENCODE-*.md`, `OPENCODE-NORMALIZED-*.md`, `OPENCODE-SUMMARY-*.md`, `OPENCODE-META-*.json`.
- Code: new `src/recall/opencode/` modules for extraction, normalization, and artifact writers.

### 2) Normalization + summarization pipeline

Outcomes:

- Normalized transcripts as stable inputs for summarization.
- JSON-only summary schema with strict validation.
- Chunk + merge path for long sessions with deterministic limits.

Concrete mapping:

- CLI: `continuum memory recall import` produces normalized + summary artifacts; add `--mode single|chunked` and `--limits` knobs.
- Data: summary JSON schema stored alongside summary markdown with a stable `summary-meta.json` payload.
- Code: `src/recall/summary/` (schema, validators, chunk planner, merge reducer) with deterministic limits config.

### 3) Source index + diff + ledger

Outcomes:

- Source index capturing fingerprints and stats per session.
- Diff report classifying new/stale/unchanged/orphan/unknown.
- Sync plan and ledger state for auditable updates.

Concrete mapping:

- CLI: add `continuum memory recall index` and `continuum memory recall diff` commands.
- Data: `$XDG_DATA_HOME/continuum/recall/opencode/source-index.json`, `diff-report.json`, `sync-plan.json`, `state.json`.
- Code: `src/recall/index/` for fingerprinting, `src/recall/diff/` for classification + plan builder.

### 4) Sync execution + audit trail

Outcomes:

- Deterministic execution of the sync plan.
- Update ledger only on success; keep logs for failures.

Concrete mapping:

- CLI: add `continuum memory recall sync` with `--plan`, `--ledger`, and `--dry-run`.
- Data: append sync results to `$XDG_DATA_HOME/continuum/recall/opencode/sync-log.jsonl` and update `state.json` only on success.
- Code: `src/recall/sync/` executor that reuses the import pipeline and emits audit events.

### 5) Retrieval index + evaluation harness

Outcomes:

- Local retrieval index over recall artifacts (BM25 first, semantic fallback).
- Deterministic keyword/alias blocks in summaries to improve BM25 hit rate.
- Evaluation harness for recall quality regression.

Concrete mapping:

- CLI: add `continuum memory recall search` with `--mode bm25|semantic|auto` and explicit mode reporting; add `continuum memory recall eval`.
- Data: qmd index directory under `.continuum/recall/opencode/.qmd/` plus eval outputs under `.continuum/recall/opencode/eval/`.
- Code: `src/recall/search/` (BM25 first, fallback), `src/recall/eval/` harness wrapper.

### 6) Memory CLI integration

Outcomes:

- First-class recall import flow wired into the memory CLI.
- Clear handoff between recall artifacts and NOW/RECENT/MEMORY tiers.

Concrete mapping:

- CLI: add `memory recall <subcommand>` group in `src/cli/commands/memory.ts` and expose `memory status` fallback to latest NOW when `.current` missing.
- Data: keep recall artifacts under `.continuum/recall/opencode/` and link to NOW/RECENT/MEMORY via frontmatter references.
- Code: `src/memory/status.ts` + `src/memory/session.ts` updates for auto-resume and fallback behaviors.

### 7) Validation gates

Outcomes:

- Typecheck + test coverage for new CLI flows.
- Smoke command(s) that validate the recall pipeline end-to-end.

Concrete mapping:

- CLI: smoke via `bun run bin/continuum memory recall import` and `bun run bin/continuum memory recall search --mode auto`.
- Data: record eval summaries in `eval/summary.json` with deterministic scoring.
- Code: add tests under `tests/recall/` and wire to `bun test`.

Validation plan (acceptance checks):

- Run `bun run typecheck` and `bun test` for schema, diff/plan, and CLI coverage.
- Smoke: `bun run bin/continuum memory recall import --summary-dir .continuum/recall/opencode --dry-run` and verify artifacts are written deterministically.
- Smoke: `bun run bin/continuum memory recall index` + `diff` + `sync --dry-run` and confirm ledger only updates on success.
- Smoke: `bun run bin/continuum memory recall search --mode auto` and verify explicit mode reporting (BM25 or semantic fallback).
- Eval: `bun run bin/continuum memory recall eval` and confirm results recorded under `eval/`.
- Memory status: `bun run bin/continuum memory status` falls back to latest NOW when `.current` is missing.

### 8) Risks, gaps, and open questions

Outcomes:

- Document coupling risks, token sizing heuristics, and orphan handling.
- Track naming/terminology decisions for context recall.

Concrete mapping:

- CLI: add `memory recall audit` to surface orphan/unknown counts and token sizing warnings.
- Data: `audit.json` or `audit.md` stored beside `diff-report.json`.
- Code: reuse `src/recall/diff/` classification metrics and expose in CLI output.
