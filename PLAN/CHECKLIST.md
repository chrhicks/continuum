# SQLite Journal Memory Redesign

## Status

- [x] Validate the proposal against the current repository architecture.
- [x] Agree that journal entries are immutable and retained after consolidation.
- [x] Agree that sessions are optional harness provenance, not Continuum lifecycle state.
- [x] Agree that OpenCode recall remains an explicit manual ingestion workflow.
- [x] Agree that Markdown becomes generated output rather than canonical storage.
- [ ] Approve this checklist before implementation.

## Target Product Model

The supported agent workflow is intentionally small:

```text
append -> consolidate -> summary/search
                 ^
                 |
       manual recall ingestion
```

- [x] `memory append` inserts one immutable journal entry into the existing project SQLite database.
- [x] `memory consolidate` persists a derived summary over a stable journal range without editing or deleting source entries.
- [x] `summary` queries journal and consolidation data directly, alongside task state.
- [x] `memory search` searches journal entries, consolidations, imported recall messages, and recall summaries.
- [x] `memory recall` manually discovers and imports OpenCode history that was not explicitly journaled.
- [x] Source session IDs remain optional provenance and never determine whether an append can succeed.
- [x] Generated Markdown remains human-readable and portable but is never authoritative.

## Explicit Non-Goals

- [x] Do not introduce a Continuum-managed session table or active-session lifecycle.
- [x] Do not require agents to start or end sessions.
- [x] Do not delete raw journal or recall messages after summarization.
- [x] Do not hold SQLite transactions open during LLM calls, OpenCode scans, or filesystem writes.
- [x] Do not permanently dual-write canonical state to SQLite and Markdown.
- [x] Do not redesign the task domain or break the public task SDK while changing memory.
- [x] Do not add automated/background recall synchronization; recall remains explicit and manual.

## Verified Current-State Constraints

- [x] SQLite currently stores only tasks and `memory_checkpoints` in `src/db/schema.ts`.
- [x] The primary DB client is cached in `src/db/client.ts`.
- [x] `src/memory/state/db-repository.ts` opens and caches a second SQLite connection and creates schema independently.
- [x] SQLite currently sets `busy_timeout` only; WAL and foreign keys are not enabled.
- [x] Memory append, session state, consolidation, summary, and search currently depend on mutable Markdown.
- [x] `.current`, SIGINT handling, `/exit`, rollover, recovery, and session commands encode lifecycle behavior that agents usually skip.
- [x] Recall import currently derives idempotency from generated MEMORY frontmatter rather than canonical database records.
- [x] Summary and search parse generated Markdown instead of querying canonical records.
- [x] The current public SDK exposes tasks only, so no public memory SDK contract needs preservation.
- [x] `CONTRIBUTING.md` currently prohibits new runtime dependencies and behavioral changes.
- [x] CLI tests, README, guides, skills, and `verify-goal-invariants.ts` encode the existing command surface.

## Canonical Data Model

### Journal Entries

- [x] Add `memory_journal_entries` through a new additive Drizzle migration; never edit historical migrations.
- [x] Use an SQLite integer primary key as the canonical monotonic consolidation boundary.
- [x] Add a stable public entry ID with a unique constraint for output, idempotency, and external references.
- [x] Store `kind`, `content`, `created_at`, and a payload/schema version.
- [x] Store optional `source`, `source_project_id`, and `source_session_id` provenance.
- [x] Store validated JSON metadata for tags, task IDs, file paths, tool names, and operation IDs.
- [x] Add a unique idempotency key when supplied by a harness or caller.
- [x] Index canonical order, creation time, kind, source, and source session.
- [x] Expose no application repository update or delete method for journal entries.

Proposed logical shape:

```text
memory_journal_entries
  sequence              INTEGER PRIMARY KEY
  id                    TEXT UNIQUE NOT NULL
  kind                  TEXT NOT NULL
  content               TEXT NOT NULL
  source                TEXT
  source_project_id     TEXT
  source_session_id     TEXT
  idempotency_key       TEXT UNIQUE
  metadata              TEXT NOT NULL
  payload_version       INTEGER NOT NULL
  created_at            TEXT NOT NULL
```

### Consolidations

- [x] Add `memory_consolidations` with stable inclusive `first_sequence` and `last_sequence` boundaries.
- [x] Persist structured summary JSON rather than relying on rendered Markdown.
- [x] Persist summary schema version and model.
- [x] Persist status and error details so failed attempts are distinguishable from completed summaries.
- [x] Process contiguous pending ranges and prevent duplicate completed records for the same exact range.
- [x] Ensure a completed consolidation can always be rendered without another LLM request.

### Recall Sources And Messages

- [x] Add `memory_recall_sources` keyed by harness and external session ID.
- [x] Persist external project/session identity, title, timestamps, source fingerprint, and ingestion timestamps.
- [x] Add `memory_recall_messages` for normalized user and agent text in original ordinal order.
- [x] Retain imported raw messages indefinitely by default for exact historical search.
- [x] Add `memory_recall_summaries` containing enriched structured summaries and generation metadata.
- [x] Track the current source fingerprint so unchanged imports are skipped and changed sessions can be refreshed.
- [x] Keep journal entries and recall records separate so generated recall claims never masquerade as explicit journal facts.
- [x] Do not make projection success part of journal append or consolidation transaction success.

## Effect Architecture

### Dependency Decision

- [x] Explicitly approve Effect as a new runtime dependency.
- [x] Update `CONTRIBUTING.md` and architectural documentation to supersede the current no-new-runtime-dependencies constraint.
- [x] Use Effect Schema for new persisted rows and JSON payloads, with existing narrow validated adapters retained for OpenCode and LLM boundaries.
- [x] Avoid a repository-wide Zod conversion before the new core is working; adapt existing validated recall types at a narrow boundary first.

### Layers And Services

- [x] Add one scoped SQLite service owning a single configured `bun:sqlite` handle per runtime/workspace.
- [x] Wrap the existing migration runner rather than introducing a second migration system.
- [x] Remove the independent DB cache and embedded schema initialization from `memory/state/db-repository.ts` after checkpoint migration.
- [x] Preserve current task repository behavior while memory uses the scoped runtime ownership model.
- [ ] Add focused Effect services for journal, consolidation, recall, projection publication, search, configuration, clock, filesystem, and LLM access.
- [x] Keep pure Markdown renderers, ranking functions, and domain transformations as ordinary TypeScript functions.
- [x] Build one managed runtime per CLI invocation instead of constructing service layers per command.
- [x] Keep Commander as a thin argument adapter and run Effects at one CLI boundary.

Suggested source layout:

```text
src/memory/
  domain/
    journal-entry.ts
    consolidation.ts
    recall.ts
    errors.ts
  application/
    append.ts
    consolidate.ts
    recall-import.ts
    summary.ts
    search.ts
  repository/
    journal-repository.ts
    consolidation-repository.ts
    recall-repository.ts
    sqlite/
  projection/
    now-projection.ts
    recent-projection.ts
    memory-projection.ts
    recall-projection.ts
  integration/
    opencode/
    llm/
  runtime/
    memory-runtime.ts
```

### Typed Errors

- [x] Define tagged errors for database open/migration/query/busy failures.
- [x] Define tagged decode errors with schema and field context.
- [x] Define journal append and idempotency errors.
- [x] Define consolidation snapshot, summarization, and persistence errors separately.
- [x] Define recall source, fingerprint, ingestion, and summary errors separately.
- [x] Define projection publication errors that can be reported as warnings after canonical persistence succeeds.
- [x] Ensure expected operational failures remain in the Effect error channel rather than becoming defects.
- [x] Render typed errors and exit codes centrally in the CLI; domain services must not print or set process exit state.

## SQLite Foundation

- [x] Configure `PRAGMA busy_timeout = 5000` consistently on the unified connection.
- [x] Enable and test `PRAGMA foreign_keys = ON`.
- [x] Evaluate and document `PRAGMA journal_mode = WAL` for local CLI concurrency before enabling it.
- [x] Define the synchronous/durability setting deliberately rather than relying on an undocumented default.
- [x] Keep write transactions short and synchronous around SQL only.
- [x] Add additive migration fixtures for databases at migrations 0000, 0001, and 0002.
- [x] Verify migrations preserve task rows and checkpoint rows exactly.
- [x] Verify repeated startup and migration are idempotent.

## Application Flows

### Append

- [x] Decode append input with Effect Schema.
- [x] Generate or accept stable entry and idempotency IDs.
- [x] Insert exactly one immutable journal row in a short transaction.
- [x] Accept optional harness/session provenance without requiring it.
- [x] Render `NOW.md` from pending entries after commit.
- [x] If rendering fails, report that the entry was saved and the projection is stale.
- [x] Make retried appends with the same idempotency key return the existing entry rather than duplicate it.
- [x] Do not parse `/exit`, create sessions, calculate duration, or trigger rollover.

### Consolidate

- [x] Read the latest completed journal boundary.
- [x] Snapshot all pending entries through a specific maximum sequence.
- [x] Return a typed no-pending-entries result when the range is empty.
- [x] Run mechanical or LLM summarization outside a write transaction.
- [x] Persist the completed summary and exact range in a short transaction.
- [x] Leave entries appended after the snapshot pending for the next run.
- [x] Never update or delete source journal entries.
- [x] Regenerate RECENT and MEMORY projections after persistence.
- [x] Treat projection failure as stale output, not failed canonical consolidation.

### Manual Recall

- [x] Retain OpenCode as the first and only initially supported recall source.
- [x] Reuse current OpenCode DB discovery, extraction, message normalization, chunking, and summary behavior where tests establish value.
- [x] Restrict normalized raw history to user and agent text unless tool content is explicitly added later.
- [x] Discover sessions and compare source fingerprints with canonical recall source records.
- [x] Support explicit session, project, date, and limit selection.
- [x] Provide a dry run showing new, changed, and current sessions without writes or LLM calls where possible.
- [x] Persist source, normalized messages, enriched summary, and ingestion checkpoint atomically after summarization succeeds.
- [x] Make rerunning an unchanged import idempotent.
- [x] Leave journal consolidation boundaries unchanged.
- [x] Remove unsupported external-command index/diff/sync machinery after the new manual flow covers required discovery and import behavior.

### Summary

- [x] Query recent pending journal entries directly.
- [x] Query recent completed consolidations directly.
- [x] Include task state through the existing task service/SDK behavior.
- [x] Optionally include recent recall summaries with clear provenance.
- [x] Stop parsing NOW, RECENT, or MEMORY Markdown to construct the briefing.
- [x] Preserve a concise agent-oriented output and JSON shape intentionally, with golden tests.

### Search

- [x] Define one result shape with source type, source ID, content, timestamp, score, and provenance.
- [x] Search raw journal entries, consolidations, recall messages, and recall summaries.
- [x] Preserve exact raw evidence even when summaries also match.
- [x] Deduplicate only in result presentation; never delete or merge canonical records.
- [x] Label raw versus derived evidence clearly.
- [x] Preserve date, source, tag, and limit filtering where still useful.
- [x] Preserve useful ranking behavior in canonical query fixtures before deleting Markdown-based search.

## Markdown Projections

- [x] Keep `NOW.md` as the pending-journal projection; remove timestamped NOW files after cutover.
- [x] Keep `RECENT.md`, `MEMORY-YYYY-MM-DD.md`, and `MEMORY.md` names initially for compatibility.
- [x] Preserve existing stable anchors where practical.
- [x] Render projections from complete SQLite query models, not by incrementally parsing and mutating existing output.
- [x] Publish each projection atomically with the existing atomic file writer.
- [x] Regenerate projections from persisted summaries without another LLM request.
- [x] Mark generated files as non-authoritative.
- [ ] Add `memory render` or equivalent repair behavior only if users need explicit regeneration; otherwise regenerate on normal operations and validation.
- [ ] Ensure deleting all generated Markdown does not affect summary or search and can be repaired from SQLite.

## Legacy Data Migration

- [x] Build an explicit dry-run-capable migration command; do not silently import ambiguous Markdown on startup.
- [x] Inventory all `NOW-*.md`, RECENT, daily MEMORY, MEMORY index, and OpenCode summary files.
- [x] Import uncleared NOW content as legacy journal entries where raw content is recoverable.
- [x] Import daily MEMORY entries as legacy completed consolidations for already summarized history.
- [x] Use RECENT only for entries not represented in daily MEMORY.
- [x] Use MEMORY index only as a fallback/reference; do not import it as duplicate memory.
- [x] Classify cleared NOW files using existing logic and avoid importing empty source content.
- [x] Store source path, checksum, migration version, and import result for every legacy artifact.
- [x] Preserve original files and write a migration completion marker.
- [x] Make repeated migration runs idempotent.

## CLI Reduction

Target memory commands:

```text
continuum memory append <kind> <text...>
continuum memory consolidate
continuum memory search <query...>
continuum memory recall status
continuum memory recall import
continuum summary
```

- [x] Decide that `recall status` serves the inventory need; no separate automated diff command is retained.
- [x] Retain `memory search` rather than adding top-level `search`.
- [x] Remove `memory session start/end/append` after append cutover.
- [x] Remove `/exit` and SIGINT session-finalization behavior.
- [x] Remove `memory recover` and rollover configuration after session lifecycle removal.
- [x] Remove filesystem-centric status/list/log commands unless retained as projection diagnostics.
- [x] Remove `repair recent` after complete projection regeneration exists.
- [x] Remove or relocate `memory collect`; task collection and manual OpenCode recall should not remain an ambiguous combined command.
- [x] Update CLI help, README, guides, skills, examples, and suggested commands together.
- [x] Update `verify-goal-invariants.ts` smoke commands to the approved surface.

## Reuse, Adapt, Remove

### Reuse

- [x] Reuse workspace resolution and OpenCode data-path discovery.
- [x] Reuse additive migration execution after placing it behind the DB service.
- [x] Reuse OpenCode extraction and message normalization.
- [x] Reuse tested summary chunking, merge behavior, and LLM request machinery behind typed application boundaries.
- [x] Reuse pure memory summary/content builders where their output remains compatible.
- [x] Reuse atomic file publication.
- [x] Preserve task repositories, services, SDK types, and task CLI behavior.

### Adapt Temporarily

- [x] Adapt current recall summary Markdown import as a legacy ingestion adapter only.
- [x] Adapt current consolidation renderers to database projection models before removing filesystem input assumptions.
- [x] Remove Markdown search after canonical database search reaches the release scope.
- [ ] Keep current config defaults and environment variable names while moving decoding to Effect Schema.

### Remove After Cutover

- [x] Remove `src/memory/session.ts` and mutable NOW writer behavior.
- [x] Remove `.current`, NOW fallback scanning, parent sessions, duration, rollover, and stale-session recovery.
- [x] Remove destructive NOW clearing and retention cleanup from consolidation.
- [x] Remove memory lock files once SQLite is canonical and projections are independent.
- [x] Remove RECENT repair-from-MEMORY logic.
- [x] Remove direct Markdown summary/search readers.
- [ ] Remove the legacy file checkpoint repository after migration support expires.
- [x] Remove unsupported recall index/diff/sync modules and compatibility re-export chains.
- [x] Remove obsolete CLI handlers, tests, and documentation after replacements pass their gates.

## Delivery Phases And Gates

### Phase 0: Contract And Fixture Freeze

- [x] Finalize the command surface and output compatibility policy.
- [x] Finalize journal kinds, provenance fields, idempotency behavior, and default indefinite retention.
- [x] Capture representative historical DB and Markdown fixtures without secrets.
- [x] Capture append, consolidate, summary, search, and recall behavior in focused and golden-ish tests.
- [x] Approve Effect and update repository constraints.

Gate:

- [x] Product decisions above are written and no main-release schema ambiguity remains.
- [ ] Legacy fixtures cover active, ended, cleared, malformed, and recall-imported memory.

### Phase 1: Effect And Unified DB Foundation

- [ ] Add Effect and define runtime, DB, config, filesystem, clock, and LLM services.
- [x] Move checkpoint access onto the primary DB ownership path.
- [ ] Preserve all current behavior through adapters.

Gate:

- [ ] Existing task SDK and CLI tests pass unchanged.
- [x] One managed SQLite ownership path exists for new memory code.
- [x] Typed operational failures do not escape as defects.

### Phase 2: Add Canonical Memory Schema

- [x] Add journal, consolidation, and recall tables.
- [x] Add Effect Schemas and repository contracts.

Gate:

- [x] The current schema and migration levels 0000, 0001, and 0002 upgrade successfully.
- [x] Existing tasks and checkpoints remain logically unchanged.
- [x] Concurrent append repository tests produce unique ordered entries.
- [ ] Idempotent retry and transaction rollback tests pass.

### Phase 3: Cut Append Over To Journal

- [x] Route `memory append` to SQLite first.
- [x] Generate compatibility NOW output from pending journal entries.
- [x] Remove append dependence on internal sessions while temporarily retaining old commands if needed.

Gate:

- [x] Append succeeds without a session ID.
- [x] Optional OpenCode session provenance is retained when supplied.
- [x] Projection failure does not lose or duplicate the entry.
- [x] Chained and concurrent CLI append tests pass.

### Phase 4: Implement Manual Recall Ingestion

- [x] Persist OpenCode source sessions, normalized messages, and enriched summaries.
- [x] Replace generated-MEMORY idempotency checks with canonical source fingerprints.

Gate:

- [x] Unchanged re-import creates no rows and performs no unnecessary summary call.
- [x] Changed sessions retain historical raw messages while refreshing the current message view and summary safely.
- [x] Interrupted imports are safely retryable.
- [x] Recall search can return both exact current messages and enriched summaries with provenance.

### Phase 5: Cut Consolidation Over To Journal Ranges

- [x] Snapshot, summarize, persist, and project immutable ranges.
- [x] Stop parsing and clearing NOW files as consolidation input.

Gate:

- [x] Entries appended during summarization remain pending.
- [x] Failed summaries produce no completed range.
- [x] Repeated exact-range requests are idempotent.
- [x] Source entry hashes and counts are unchanged after consolidation.

### Phase 6: Complete Projections And Legacy Migration

- [x] Generate supported Markdown projections from SQLite.
- [x] Implement explicit migration of existing Markdown and recall artifacts.

Gate:

- [x] Projection failure preserves prior published files.
- [x] Deleting projections does not affect canonical queries.
- [x] Migration dry run reconciles source counts and repeated runs add nothing.

### Phase 7: Cut Summary And Search Over

- [x] Query canonical records instead of Markdown.
- [x] Integrate journal and recall evidence with explicit provenance.

Gate:

- [x] Summary works before any Markdown projection exists.
- [x] Search survives projection deletion.
- [x] Ranking, filters, excerpts, and provenance pass golden query tests.

### Phase 8: Remove Legacy Surface

- [x] Remove session lifecycle, recovery, destructive consolidation, unsupported recall automation, and old readers.
- [x] Reduce command registration and documentation to the approved workflow.

Gate:

- [x] No production import reaches deleted legacy modules.
- [x] README, guides, skills, smoke tests, and CLI help agree.
- [x] Task SDK contract remains unchanged.
- [x] Full `bun run validate` passes.

## Required Test Matrix

- [ ] Schema decoding tests for every persisted JSON and external boundary.
- [x] Migration tests from the current schema and migration levels 0000, 0001, and 0002.
- [x] Concurrent multi-process append tests.
- [x] Idempotent append retry tests.
- [ ] Transaction rollback tests for append, recall ingestion, and consolidation persistence.
- [x] Stable range snapshot tests with concurrent appends.
- [x] Recall unchanged/changed/interrupted import tests.
- [x] Projection atomicity and regeneration tests.
- [x] Legacy Markdown migration reconciliation and duplicate-prevention tests.
- [x] Unified search ranking and provenance tests.
- [x] Human and JSON CLI golden tests.
- [x] Existing task SDK contract tests.
- [x] Full typecheck, test suite, formatter, and goal invariant validation at the completed main-release gate.

## Decisions Still Required

- [x] Define allowed CLI journal kinds as user, agent, and tool.
- [x] Choose generated UUID public entry IDs and return-existing caller idempotency semantics.
- [x] Keep raw recall messages in database search rather than generated Markdown.
- [x] Choose the reduced CLI commands with no removed-command compatibility period.
- [x] Retain existing Markdown names and practical anchors as migration compatibility, not canonical contracts.

## Backlog: Optional Hardening

These items are explicitly non-blocking for the first journal release. Revisit them only when usage, scale, compliance requirements, or observed failures justify the added complexity.

### Data Governance

- [ ] Add SQLite triggers preventing direct journal `UPDATE` or `DELETE` if repository-level immutability proves insufficient.
- [ ] Design correction and redaction records if users need to amend immutable history.
- [ ] Add an administrative deletion workflow if secret removal or legal requirements demand it.

### Consolidation History

- [ ] Persist complete prompt and configuration versions when reproducibility requirements justify it.
- [ ] Support overlapping or named consolidation ranges if contiguous primary ranges are insufficient.
- [ ] Support explicit consolidation supersession while retaining prior summaries.

### Recall Version History

- [ ] Preserve every historical summary version for changed OpenCode sessions.
- [ ] Track prompt/schema versions independently from the current source fingerprint.

### Projection Diagnostics

- [ ] Add a projection-state table with source boundary, renderer version, output hash, rendered time, and last error.
- [ ] Require byte-for-byte deterministic projections and renderer-version fixtures.
- [ ] Add richer stale-projection diagnostics beyond reporting the publication error.

### Database And Search Scaling

- [ ] Add exhaustive migration fixtures for every historical migration level.
- [ ] Add explicit managed-runtime handle-close tests if leaked handles become observable.
- [ ] Evaluate SQLite FTS5 when journal size or search latency makes the existing approach inadequate.

### Migration And Compatibility

- [ ] Add a formal migration rollback/export command if retaining untouched original Markdown is insufficient.
- [ ] Preserve legacy search file paths and line numbers if external consumers require them.
- [ ] Add temporary removed-command compatibility shims if real user automation depends on them.

## Definition Of Done

- [x] SQLite is the sole canonical store for journal entries, consolidations, and recall imports.
- [x] Journal and recall raw history remain immutable and searchable after summarization.
- [x] Appending requires no Continuum session lifecycle.
- [x] Harness session IDs are optional, queryable provenance.
- [x] Consolidation is non-destructive, range-based, retryable, and explainable.
- [x] Recall is explicit, manual, idempotent, and OpenCode-backed.
- [ ] Markdown can be deleted and regenerated without data loss.
- [x] Summary and search do not parse Markdown for canonical information.
- [x] The reduced CLI reflects actual agent behavior.
- [x] Expected errors are typed and rendered accurately through Effect.
- [x] Existing task behavior and SDK contracts remain intact.
- [x] Legacy memory has a tested, idempotent migration path.
- [x] Obsolete lifecycle, locking, recovery, and recall automation code is removed.
