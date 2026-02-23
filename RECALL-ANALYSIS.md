# Recall Prototype Analysis

This document summarizes what the OpenCode recall prototype achieved, how it works, what held up well vs. what did not, and which high-quality, reliable methods should be ported into the official memory CLI.

## Scope and sources

Primary prototype files reviewed:

- scripts/opencode-recall-prototype.ts
- scripts/opencode-recall-index-prototype.ts
- scripts/opencode-recall-diff-prototype.ts
- scripts/opencode-recall-sync-prototype.ts
- scripts/opencode-recall-qmd-prototype.ts
- scripts/opencode-recall-qmd-eval-prototype.ts

## 1) Architecture and technical review

### 1.1 End-to-end pipeline (data flow)

The prototype implements a complete recall pipeline that can be summarized as:

1. Extract session data from OpenCode SQLite.
2. Normalize transcripts into stable text inputs.
3. Summarize sessions into structured JSON (single-pass or chunked).
4. Write recall artifacts to `.continuum/recall/opencode`.
5. Build a source index and compute diffs vs. summaries.
6. Generate a sync plan and apply it to reprocess stale sessions.
7. Optionally index summaries for retrieval and run evaluation.

Key files:

- Extraction and summarization: scripts/opencode-recall-prototype.ts
- Source index: scripts/opencode-recall-index-prototype.ts
- Diff and sync plan: scripts/opencode-recall-diff-prototype.ts
- Sync executor: scripts/opencode-recall-sync-prototype.ts
- Retrieval index and eval: scripts/opencode-recall-qmd-prototype.ts, scripts/opencode-recall-qmd-eval-prototype.ts

### 1.2 Data extraction and normalization

The prototype reads `project`, `session`, `message`, and `part` tables from the OpenCode DB. It resolves the target project by matching the repo worktree or a CLI flag, then walks sessions in a deterministic, timestamp-ordered pass.

Key behaviors (scripts/opencode-recall-prototype.ts):

- Session selection by project + time ordering.
- Message ordering by timestamps and part ordering by start time.
- Transcript assembly with tool call markers and rich metadata.
- Normalized transcript generation that trims whitespace and aggregates user/assistant text in a consistent format.
- Fallbacks to message summaries when text is empty.

Output is written as:

- Raw transcript (`OPENCODE-*.md`)
- Normalized transcript (`OPENCODE-NORMALIZED-*.md`)
- Structured summary (`OPENCODE-SUMMARY-*.md` and meta json)

### 1.3 Summary generation design

The summarizer uses a strict JSON schema to capture:

- focus, decisions, discoveries, patterns
- tasks, files, blockers
- open_questions, next_steps, confidence

Important design points (scripts/opencode-recall-prototype.ts):

- Two modes: single-pass or chunked based on estimated size.
- Chunking uses max lines + max chars thresholds, then merges with a follow-up prompt.
- JSON parse validation and strict schema enforcement.
- Post-processing filters that drop transient items and keep file references grounded in the transcript.
- Optional debug artifacts (raw model output, summary quality report, chunk inputs).

### 1.4 Source index and diff plan

The index step produces a stable, versioned source index of OpenCode sessions, including:

- Fingerprint: derived from session metadata and message/part stats.
- Project/session maps and aggregate stats.

The diff step compares source index to summaries and classifies sessions as:

- new, stale, unchanged, orphan, unknown

Outputs include:

- diff report (`diff-report.json`)
- sync plan (`sync-plan.json`)
- ledger/state file (`state.json`)

Files:

- scripts/opencode-recall-index-prototype.ts
- scripts/opencode-recall-diff-prototype.ts

### 1.5 Sync execution

The sync prototype executes a templated CLI command for each plan entry, passing session and project identifiers. It updates the ledger only on success.

Files:

- scripts/opencode-recall-sync-prototype.ts

### 1.6 Retrieval indexing and evaluation

The qmd prototypes index summaries into a retrieval collection and provide an evaluation harness with exact/semantic/negative tests and per-mode metrics.

Files:

- scripts/opencode-recall-qmd-prototype.ts
- scripts/opencode-recall-qmd-eval-prototype.ts

## 2) What works well and what does not

### What works well

- Structured JSON summaries with schema validation are resilient and make downstream parsing reliable. (scripts/opencode-recall-prototype.ts)
- Chunking and merge strategies handle long sessions while keeping outputs coherent. (scripts/opencode-recall-prototype.ts)
- Diff + sync planning yields deterministic, auditable reprocessing. (scripts/opencode-recall-index-prototype.ts, scripts/opencode-recall-diff-prototype.ts)
- Evaluation harness provides a clear signal for retrieval regression. (scripts/opencode-recall-qmd-eval-prototype.ts)
- Normalized transcript output creates a stable, inspectable record that can be used for re-summarization and QA. (scripts/opencode-recall-prototype.ts)

### What does not work well / risks

- Tight coupling in the main prototype script (DB access + transcript + summarization + output + debug) makes it hard to test or reuse. (scripts/opencode-recall-prototype.ts)
- Reliance on external tools and shell invocation for sync/search reduces portability and robustness. (scripts/opencode-recall-sync-prototype.ts, scripts/opencode-recall-qmd-prototype.ts)
- Timestamp-based recency classification can drift or become ambiguous when data is missing or clocks differ. (scripts/opencode-recall-diff-prototype.ts)
- Token estimation is heuristic and can mis-size chunks for certain languages or content. (scripts/opencode-recall-prototype.ts)
- Orphan/unknown classification is not tied to a remediation flow, so it can accumulate. (scripts/opencode-recall-diff-prototype.ts)

## 3) High-quality, reliable methods to port into the official memory CLI

Only methods that are robust, testable, and deterministic are recommended here.

### 3.1 Deterministic source indexing and fingerprinting

Port the source index concept to the memory system to enable incremental, auditable updates. The index should capture session-level fingerprints derived from metadata plus message/part stats, similar to the prototype index.

- Source: scripts/opencode-recall-index-prototype.ts

### 3.2 Normalized transcript generation

Normalize transcripts prior to summarization to reduce noise and provide a consistent input/output trail. This is a low-risk, high-leverage improvement for future memory summarization.

- Source: scripts/opencode-recall-prototype.ts

### 3.3 Structured summary schema with strict validation

Adopt the JSON-only summary schema and strict parsing/validation used in the prototype. The model outputs are more reliable and easier to feed into RECENT/MEMORY summaries.

- Source: scripts/opencode-recall-prototype.ts

### 3.4 Chunked summarization with merge passes

Port the chunking and merge flow for long transcripts. The approach is reliable and demonstrably handles large sessions without truncation, provided chunk sizes are configured conservatively.

- Source: scripts/opencode-recall-prototype.ts

### 3.5 Diff + sync plan artifacts

Keep the diff report + sync plan + ledger pattern. It separates detection from execution, is deterministic, and gives operators confidence before applying updates.

- Source: scripts/opencode-recall-diff-prototype.ts, scripts/opencode-recall-sync-prototype.ts

### 3.6 Retrieval evaluation harness

Preserve the evaluation harness as a regression gate for recall quality when summarization models or indexers change.

- Source: scripts/opencode-recall-qmd-eval-prototype.ts

## Summary of achievements

The prototype proved that OpenCode sessions can be extracted, normalized, summarized into structured JSON, indexed, diffed, and re-synchronized deterministically, with retrieval evaluation for quality control. The pipeline is operationally coherent but remains disconnected from the official memory CLI, which currently focuses on NOW/RECENT/MEMORY files. The most reliable parts to port are the deterministic indexing, structured summarization, chunked processing, and diff/plan/ledger workflow.
