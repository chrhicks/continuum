# CHI-114 Continuum human-readability architecture audit

## 1. Executive answer

**Primary question:** Can a mid-level engineer understand each important Continuum success path in one reading on the current active staging baseline, without excessive scrolling, call-stack traversal, hidden temporal coupling, or reconstructing behavior from implementation mechanics?

**Answer: not yet for every important path.** The current baseline has several strong, domain-shaped success paths. Canonical storage preparation, backup creation, OpenCode session summarization, and legacy-memory migration can each be read top-down as meaningful steps. CHI-111 and CHI-112 also resolved two of CHI-110's three architecture findings: backup configuration now has one runtime acquisition, and storage authority is explicit at the workspace boundary.

The answer remains negative because eight evidence-backed comprehension findings remain:

1. CLI memory commands hide storage authority and database lifecycle behind a generic runner and process-global workspace context.
2. Memory application functions support both injected scoped dependencies and self-acquired global cached clients, so resource ownership is not visible at the operation boundary.
3. Recall import combines a fourteen-field mostly optional request/dependency bag with a helper that mutates a shared result accumulator.
4. Task relationship expansion and transition validation are independently implemented in CLI/SDK and MCP paths.
5. Memory list/search semantics require mentally simulating a `source × tier × current/history` matrix across two functions and a mutating recall loader.
6. At least 672 lines of neutral-named, production-unreachable source present competing checkpoint, Markdown-init, recent-entry, and LLM JSON paths beside the canonical architecture.
7. `listBackups` accepts and receives a workspace root that it never uses, making the public backup operation contracts look more uniform than their actual dependencies.
8. The Linear agent runner still expresses its entire lifecycle as flat shell implementation mechanics; this is a fresh confirmation and duplicate of CHI-110 C-003.

The first seven findings are disposition-ready campaign ledger items. The eighth must remain preserved as a duplicate with the existing CHI-110 rationale. None is asserted as a newly reproduced product-correctness defect, and none was implemented in this inquiry.

## 2. Method and inspected source range

### Baseline

```text
repository: chrhicks/continuum
active base/head: staging/xdg-storage-migration
baseline commit: 736dbeca170f2ce5f3a1f51c1a30ed3675c73c85
master reference: e693a594b36166025b21500642093aa8d5ea0da1
range inventory: origin/master...736dbeca170f2ce5f3a1f51c1a30ed3675c73c85
range size: 124 files, 9,661 additions, 837 deletions
current source: 159 TypeScript files, 19,117 lines
current tests: 33 TypeScript files (30 `.test.ts` specs), 6,179 lines
```

All source links below are commit-pinned to `736dbeca170f2ce5f3a1f51c1a30ed3675c73c85`. Line ranges therefore remain stable after later staging work.

### Inspection procedure

The audit did not reuse CHI-110's three findings as a result set. It freshly:

- inventoried every tracked top-level group, every `src/**/*.ts` and `tests/**/*.ts` file by size, the complete `origin/master...staging` name/status range, and all exported operation surfaces;
- mapped local imports from the CLI and public SDK roots, identifying 150 of 159 source files as production-reachable and reviewing the nine exceptions individually;
- read the current CLI entry and command composition, workspace resolution/context, storage authority and migration/fork protocols, database client/runtime ownership, task SDK/service/repository and MCP adapters, memory append/consolidate/query/recall/legacy-migration paths, backup runtime/service/status/remote/locking paths, LLM request/response and OpenCode summarization paths, and Linear agent runner/validation scripts;
- inspected the large storage, backup, MCP, memory, SDK, and runtime test suites and their scenario inventories; and
- compared current code with [CHI-105](./CHI-105-staging-audit.md), [CHI-110](./CHI-110-architecture-complexity-audit.md), and the post-audit CHI-111/CHI-112 changes only for regression and deduplication.

This is a static comprehension audit plus repository validation, not a timed usability study. “One reading” means a reader can identify the success-path order, authority, and major state transitions from the operation and its immediately owned helpers without reconstructing them from transport duplication, ambient state, or unrelated implementation branches.

## 3. Current architecture and success-path maps

### Main boundaries

```text
CLI
  -> command parser/renderer
  -> SDK for tasks OR Effect memory/backup operation
  -> task service / memory application / backup service
  -> repository or storage protocol
  -> SQLite / filesystem / Wrangler

MCP
  -> tool registration schema
  -> read-only or writable adapter
  -> task service / memory application
  -> repository or storage protocol

Workspace and storage
  -> resolve workspace request
  -> resolve claimed | observed | deferred StorageAuthority
  -> pure canonical path projection
  -> prepare migration state machine when write authority is required
```

### Clearly readable current paths

```text
createLockedBackup
  -> claim storage authority
  -> prepare canonical database
  -> read WAL-aware snapshot
  -> read initial remote head
  -> create generation and manifest
  -> upload immutable database and manifest
  -> assert head unchanged
  -> publish and verify head
```

Evidence: [`src/backup/service.ts:66-97`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/backup/service.ts#L66-L97).

```text
prepareCanonicalDatabase
  -> resolve old path-hash and current storage paths
  -> upgrade path-hash storage if present
  -> prepare without legacy source
  -> verify recorded migration
  -> adopt an already published lineage destination
  -> require explicit initialization or migrate legacy storage
```

Evidence: [`src/db/storage.ts:39-77`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/db/storage.ts#L39-L77).

```text
summarizeOpencodeSession
  -> build client
  -> plan chunks
  -> return empty summary when appropriate
  -> collect chunk summaries
  -> return one summary or merge many
```

Evidence: [`src/memory/collectors/opencode-summary.ts:35-72`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/memory/collectors/opencode-summary.ts#L35-L72).

```text
migrateLegacyMemory
  -> stop at completed run
  -> inventory artifacts
  -> plan imports
  -> require a writable handle only for persistence
  -> order NOW after completed history and persist atomically
```

Evidence: [`src/memory/application/legacy-migrate.ts:10-45`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/memory/application/legacy-migrate.ts#L10-L45).

### Paths that require reconstruction

```text
CLI summary/search/status
  -> Commander hook may change process.cwd
  -> hook may install a process-global deferred workspace context
  -> command selects runMemoryCommand
  -> runner claims storage authority and prepares migration
  -> runner opens a scoped writable MemoryRuntime
  -> operation may also acquire a global cached client
```

```text
task get/validate
  CLI -> SDK implementation -> task service -> repository
  MCP -> MCP implementation -> task service -> repository
       (relationship expansion and validation repeated independently)
```

```text
memory search
  -> list memory evidence with rewritten source options
  -> conditionally load journal/consolidation data
  -> conditionally mutate the result with current recall
  -> search path conditionally mutates it again with recall history
  -> filter/sort once or twice depending on branch
  -> score and re-sort
```

```text
agent run-once
  -> validate profile and 30 settings
  -> validate checkout and five runtime representations
  -> create state/exclusion/lock/audit/lease
  -> render envelope and Pi argv
  -> execute and parse textual markers
  -> update audit and dispatch another systemd profile
```

## 4. Coverage ledger

| Requested dimension                                              | Conclusion                                                                                                                                                                                                                                                                                                                                                                                                     | Evidence                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top-level operations as named domain steps                       | **Mixed.** Storage preparation, backup creation, OpenCode summarization, and legacy migration are clear. CLI memory execution and the agent runner are not expressed as domain phases.                                                                                                                                                                                                                         | Positive paths above; HR-001, HR-008                                                                                                                                                                                                                                                                                                                                                    |
| Mixed abstraction levels in orchestration                        | **Findings.** CLI execution mixes rendering concerns with storage claim/migration/runtime acquisition; memory query mixes selection policy, SQL, decoding, mutation, filtering, and ordering; shell lifecycle mixes every phase.                                                                                                                                                                               | HR-001, HR-005, HR-008                                                                                                                                                                                                                                                                                                                                                                  |
| Implementation mechanics embedded in success-path code           | **Findings.** Query SQL/row construction and shell environment/JQ/systemd mechanics dominate their operation flow. Storage/backup mechanics are appropriately below domain-shaped orchestration.                                                                                                                                                                                                               | HR-005, HR-008; positive storage/backup maps                                                                                                                                                                                                                                                                                                                                            |
| File size, scrolling, and navigation burden                      | **Findings with a positive bound.** All 159 source files remain below 300 lines, but the 276-line query module, 672 production-unreachable lines, 248-line runner, 152-line verifier, and 342-line smoke script still create targeted navigation burden. The 641-line storage and 625-line backup test files are long but present coherent sequential scenario inventories, so they are not separate findings. | HR-005, HR-006, HR-008; `wc -l` inventory; [`tests/storage-migration.test.ts:47-508`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/tests/storage-migration.test.ts#L47-L508), [`tests/backup-service.test.ts:48-404`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/tests/backup-service.test.ts#L48-L404) |
| Nesting, branching, and temporal coupling                        | **Findings.** Recall import mutates counters across a helper; memory query behavior changes through nested negative conditions and repeated mutation; agent state and marker interpretation depend on a long temporal sequence.                                                                                                                                                                                | HR-003, HR-005, HR-008                                                                                                                                                                                                                                                                                                                                                                  |
| Call-stack depth required to understand behavior                 | **Finding.** Task get/validate require transport, SDK or MCP, service, storage authority, and repository traversal, while the domain-level relationship/validation operation is duplicated instead of named once. Storage and backup use deeper helpers only for cohesive safety concepts.                                                                                                                     | HR-004; positive maps                                                                                                                                                                                                                                                                                                                                                                   |
| Parameter threading and vague option/configuration bags          | **Findings.** Recall import has fourteen mostly optional request/dependency fields; backup list threads an unused workspace root; memory operations use optional repositories/handles to switch ownership models.                                                                                                                                                                                              | HR-002, HR-003, HR-007                                                                                                                                                                                                                                                                                                                                                                  |
| Action at a distance and hidden state transitions                | **Findings.** Process-global workspace context, hidden claim/migration in `runMemoryCommand`, module-global DB caches, optional context fallbacks, and mutating evidence/result arrays conceal transitions.                                                                                                                                                                                                    | HR-001, HR-002, HR-003, HR-005                                                                                                                                                                                                                                                                                                                                                          |
| Naming and obviousness of responsibilities at call sites         | **Findings and positives.** `runMemoryCommand` and neutral `memory/state` names conceal authority/liveness; `listBackups(workspaceRoot)` advertises a false dependency. `StorageAuthority` modes and backup protocol helper names are clear.                                                                                                                                                                   | HR-001, HR-006, HR-007; positive findings                                                                                                                                                                                                                                                                                                                                               |
| Duplication requiring comparison of near-identical paths         | **Finding.** Task expansion and transition validation are independently implemented for CLI/SDK and MCP. No comparable duplication remains in backup configuration acquisition after CHI-111.                                                                                                                                                                                                                  | HR-004; positive CHI-111 evidence                                                                                                                                                                                                                                                                                                                                                       |
| Wrappers/extractions that relocate rather than reduce complexity | **Finding and explicit no-finding conclusion elsewhere.** The task service's many directory wrappers add a hop without owning get/validate use cases, contributing to HR-004. Storage publication, snapshot, and backup protocol helpers hide cohesive mechanics and should be preserved. No recommendation below proposes one-line wrappers or generic frameworks.                                            | HR-004; [`src/task/tasks.service.ts:77-188`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/task/tasks.service.ts#L77-L188), [`src/db/storage-publication.ts:22-47`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/db/storage-publication.ts#L22-L47)                                                |
| Areas already clear, with evidence                               | **Positive conclusion.** Explicit storage authority, pure paths, canonical migration, configured backup runtime, backup creation, OpenCode summarization, legacy migration, and MCP read-only resolution are clear enough to preserve.                                                                                                                                                                         | Section 6                                                                                                                                                                                                                                                                                                                                                                               |

Every requested dimension therefore has cited evidence or an explicit evidence-backed conclusion. No dimension was replaced by a generic architecture concern.

## 5. Complete prioritized finding inventory

### HR-001 — P2: CLI memory access policy is hidden in generic execution and global context

**Direct answer to the primary question.** A mid-level engineer cannot determine from a summary, search, or recall-status handler whether the command observes, claims, migrates, creates, caches, or closes storage. That behavior is encoded elsewhere by command ancestry and runner choice.

**Evidence.**

- [`src/cli.ts:110-151`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/cli.ts#L110-L151) changes `process.cwd`, detects whether the action is below the `memory` command, and installs/restores ambient context.
- [`src/workspace/context.ts:3-18`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/workspace/context.ts#L3-L18) stores that context in a process-global variable.
- [`src/cli/io.ts:150-180`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/cli/io.ts#L150-L180) turns deferred context into a claimed authority, prepares canonical migration, creates a scoped writable runtime, and runs the Effect.
- Read-oriented handlers select that behavior only by calling `runMemoryCommand`: [`src/cli/commands/summary.ts:21-47`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/cli/commands/summary.ts#L21-L47) and [`src/cli/commands/memory/recall-basic-handlers.ts:11-24`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/cli/commands/memory/recall-basic-handlers.ts#L11-L24).

**Current reading path.**

```text
read handler
  -> runMemoryCommand
     -> get ambient context or resolve deferred context
     -> claimStorageAuthority
     -> prepareCanonicalDatabase
     -> memoryRuntimeLayer (open/migrate/close)
     -> run Effect and render
```

**Reader impact and audience.** CLI and memory maintainers must inspect `cli.ts`, `workspace/context.ts`, `cli/io.ts`, workspace resolution, and storage authority before they can classify a command's access. The name `runMemoryCommand` communicates domain and rendering, not authority or mutation.

**Bounded recommendation.** Resolve a validated CLI workspace/runtime request once at the command composition boundary with an explicit access mode. Give read-only observation and writable memory execution distinct cohesive paths, and pass the resolved context/runtime to handlers rather than installing it globally. Preserve the common JSON/error renderer, but do not let that renderer own claim/migration policy.

**Keep inline.** Keep `--cwd` parsing, JSON/quiet rendering, and the selected access mode visible at each command registration or one explicit command metadata table.

**Trade-offs.** Commander hooks currently centralize `--cwd`; replacing ambient context touches all memory commands. Regression coverage must preserve nested command behavior, process-CWD restoration expectations, CLI output, initialization, read-only failure, and migration behavior.

**Disposition:** `campaign-ledger` — pending import into CHI-113; inquiry-only, no implementation or follow-up issue created.

### HR-002 — P2: memory application operations have two resource-ownership modes

**Direct answer to the primary question.** Core memory operations cannot be read as owning one resolved runtime. Their signatures allow injected scoped repositories or implicit globally cached database acquisition, and one operation acquires the global handle even when both repositories were injected.

**Evidence.**

- [`src/db/client.ts:22-84`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/db/client.ts#L22-L84) maintains module-global writable/read-only client caches and a first-migration set.
- [`src/memory/application/append.ts:34-48`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/memory/application/append.ts#L34-L48) selects an injected repository or creates one from the global cached client.
- [`src/memory/application/consolidate.ts:48-66`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/memory/application/consolidate.ts#L48-L66) unconditionally calls `getDbClientByPath` before selecting injected journal and consolidation repositories.
- The CLI explicitly creates a scoped runtime and passes repositories in [`src/cli/commands/memory/handlers.ts:93-110`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/cli/commands/memory/handlers.ts#L93-L110), while MCP append omits the repository and uses fallback acquisition in [`src/mcp/tools.ts:53-81`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/mcp/tools.ts#L53-L81).

**Why this is difficult.** `dbPath` appears to be data, `repository?` appears to be a test seam, and `MemoryRuntime` appears to own the database lifetime. In reality those choices select different acquisition, migration, caching, and closing behavior. A reader must inspect every call site to know which model applies. In consolidation, even the apparently fully injected CLI path performs hidden global acquisition.

**Reader impact and audience.** Memory application, MCP, CLI, and test maintainers cannot reason locally about handle lifetime or whether one operation has one database authority.

**Bounded recommendation.** Make the core memory application context explicit and required: resolved paths plus the repositories/handle the operation actually owns. Put global long-lived MCP acquisition and scoped CLI acquisition in named composition roots. Keep optional summarizer, clock, publication, and extractor test capabilities in a clearly separate dependency record rather than coupling them to database fallback.

**Keep inline.** Keep the append/consolidation transaction order and stale-projection result handling in the application functions.

**Trade-offs.** Tests currently benefit from compact partial options, and MCP intentionally wants process-lifetime handles. The change should preserve both lifetimes as explicit compositions, not force one lifetime everywhere.

**Disposition:** `campaign-ledger` — pending import into CHI-113.

### HR-003 — P2: recall import combines a vague option bag with shared mutable outcome state

**Direct answer to the primary question.** The recall-import success path requires reconstructing which combinations of fourteen optional fields resolve workspace, source, repository, summary configuration, dependencies, and dry-run semantics, then tracing mutations performed by `importSession` on an outer accumulator.

**Evidence.**

- [`src/memory/application/recall-import.ts:25-57`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/memory/application/recall-import.ts#L25-L57) defines one mostly optional record containing request filters, workspace paths, repositories, configuration, clock, summarizer, and extractor.
- [`src/memory/application/recall-import.ts:58-105`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/memory/application/recall-import.ts#L58-L105) conditionally reads ambient workspace state only when both explicit path fields are not present, acquires other dependencies, initializes mutable counters, and loops.
- [`src/memory/application/recall-import.ts:141-205`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/memory/application/recall-import.ts#L141-L205) receives the entire options bag plus the result object and mutates `skippedExisting`, `changed`, `imported`, and `importedSessions` across early returns.

**Why this is difficult.** Request data and dependency injection have no visual boundary. Valid combinations are implicit. The per-session function returns `void`, so its meaningful outcome is action at a distance. Dry run, unchanged source, changed source, missing config, summary, replacement, and final counters are temporally coupled.

**Reader impact and audience.** A memory/recall maintainer must read most of the 249-line file and its CLI/MCP callers to understand the ordinary “import one changed session” outcome. Test authors can accidentally exercise a different acquisition path by omitting one option.

**Bounded recommendation.** Split resolved `RecallImportRequest` from required `RecallImportDependencies`. Resolve workspace/config/repository once before the core operation. Have the per-session operation return a closed outcome such as `current | would-import | would-refresh | imported | refreshed`, then aggregate those values in the top-level loop. This reduces temporal coupling without extracting fingerprint or row-construction one-liners.

**Keep inline.** Keep normalization, fingerprinting, summary, and atomic repository replacement together in the per-session operation.

**Trade-offs.** The types become more explicit and test fixtures slightly longer. The benefit depends on closed outcome variants rather than another vague options layer.

**Disposition:** `campaign-ledger` — pending import into CHI-113; depends naturally on HR-002's explicit application context.

### HR-004 — P2: task get and validation behavior is duplicated across transports

**Direct answer to the primary question.** There is no single domain operation a reader can follow for an expanded task view or transition validation. The CLI/SDK and MCP paths independently reproduce the same relationship and blocker behavior through different mappings.

**Evidence.**

- CLI task expansion is implemented in [`src/cli/commands/task.ts:111-153`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/cli/commands/task.ts#L111-L153).
- MCP task expansion is separately implemented in [`src/mcp/task-read-tools.ts:49-97`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/mcp/task-read-tools.ts#L49-L97).
- SDK transition validation is implemented in [`src/sdk/index.ts:122-147`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/sdk/index.ts#L122-L147); MCP repeats it in [`src/mcp/task-read-tools.ts:100-135`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/mcp/task-read-tools.ts#L100-L135).
- The service layer then adds fourteen similarly shaped directory-to-database wrappers rather than owning these query use cases: [`src/task/tasks.service.ts:37-61`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/task/tasks.service.ts#L37-L61) and [`src/task/tasks.service.ts:77-188`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/task/tasks.service.ts#L77-L188).

**Current reading paths.**

```text
CLI get -> loadTaskGetResult -> SDK get/list -> task service -> repository
MCP get -> getMcpTask/listMcpTasks/getMappedTask -> task service -> repository

SDK validate -> repository task -> validate_status_transition -> blocker query
MCP validate -> repository task -> validate_status_transition -> blocker query
```

**Why this is difficult.** The transport layers own domain assembly, while the service mostly delegates. A reader must compare implementations to determine whether parent absence, deleted children, missing blockers, read-only access, and completed transitions are consistent.

**Reader impact and audience.** CLI, MCP, SDK, and task maintainers pay repeated call-stack traversal and parity checking for common operations.

**Bounded recommendation.** Add transport-neutral task application operations for “load task view” and “validate transition” that own relationship/blocker assembly and explicit read access. Let CLI and MCP parse transport options and render/envelope the same returned models. Consolidate only cohesive use cases; do not create wrappers around every repository call or a generic query framework.

**Keep inline.** Keep Commander option parsing/rendering and MCP schemas/tool envelopes in their adapters. Keep row persistence in repositories.

**Trade-offs.** The public SDK compatibility surface must remain unchanged, and read-only MCP access must remain explicit. A careless extraction could merely add another hop; it is useful only if it removes the duplicate domain assembly.

**Disposition:** `campaign-ledger` — pending import into CHI-113.

### HR-005 — P2: memory list/search encodes an implicit selection matrix in mechanics

**Direct answer to the primary question.** A reader cannot understand memory search inclusion rules in one pass. They must simulate negative conditions for `source` and `tier`, distinguish current recall from historical recall, and follow mutation/filter/order behavior across two modules.

**Evidence.**

- [`src/memory/application/query.ts:26-32`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/memory/application/query.ts#L26-L32) defines two selection axes without an explicit query plan.
- [`src/memory/application/query.ts:42-127`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/memory/application/query.ts#L42-L127) interleaves selection policy, SQL, decoding, DTO construction, mutation, filtering, ordering, limits, and error mapping.
- Search rewrites options and takes a second path in [`src/memory/application/query.ts:130-198`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/memory/application/query.ts#L130-L198), including conditions where `tier: undefined` and `tier: all` behave equivalently only after inspection.
- [`src/memory/application/query-recall.ts:33-64`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/memory/application/query-recall.ts#L33-L64) appends current or historical recall rows into a caller-owned array.

**Reader impact and audience.** Memory retrieval maintainers and reviewers must reconstruct the selection truth table before changing filters or explaining why list and search include different recall history. The 276-line file also requires scrolling between policy and helper details.

**Bounded recommendation.** Build an explicit evidence query plan from the request, then have named source loaders return journal, consolidation, current-recall, or recall-history arrays. Combine, filter, and order once. Keep SQL and decoding inside each source loader. Return arrays rather than mutating a caller-owned accumulator.

**Keep inline.** Keep the simple term scoring pipeline visible in `searchMemoryEvidence`; it is not the source of the comprehension problem.

**Trade-offs.** More named loaders are justified only if each owns one evidence source. Avoid a generic repository/query-builder abstraction and preserve exact list/search semantics with a small source/tier matrix test.

**Disposition:** `campaign-ledger` — pending import into CHI-113.

### HR-006 — P2: dormant modules present competing memory architectures

**Direct answer to the primary question.** Repository navigation exposes neutral-named checkpoint and Markdown-era modules that are not on the current CLI or SDK production graph. A mid-level engineer cannot know they are dormant from their names or location and may reconstruct a false memory success path.

**Evidence.**

- The neutral `MemoryStateRepository` and in-memory checkpoint model occupy [`src/memory/state/repository.ts:1-57`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/memory/state/repository.ts#L1-L57).
- File and database implementations appear production-ready at [`src/memory/state/file-repository.ts:1-40`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/memory/state/file-repository.ts#L1-L40) and [`src/memory/state/db-repository.ts:24-45`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/memory/state/db-repository.ts#L24-L45), but `createDbMemoryStateRepository` and `createFileMemoryStateRepository` have no call sites.
- [`src/memory/init.ts:1-45`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/memory/init.ts#L1-L45) defines a separate Markdown/config/log initialization path with no inbound import.
- [`src/cli/commands/recent-entry-parser.ts:1-25`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/cli/commands/recent-entry-parser.ts#L1-L25), `src/llm/index.ts`, and `src/llm/json.ts` are likewise unreachable from `src/cli.ts` plus `src/sdk/index.ts`; the JSON helper is test-only.
- A static local-import graph found 150/159 source files reachable from the CLI and SDK roots. Excluding the entry declaration itself, the unreachable implementation set totals 672 lines.

**Why this is difficult.** README correctly says SQLite journal/recall is canonical and Markdown is projection-only, yet source layout advertises a second “state repository,” file persistence, DB checkpoints, memory initializer, and recent-entry parser without `legacy`, `migration`, or `unused` naming. The reader must use whole-repository reference searches to reject those paths.

**Reader impact and audience.** New memory maintainers, reviewers, and agents incur repository archaeology before they can trust the canonical path. Search results and symbol completion surface inactive concepts alongside active repositories.

**Bounded recommendation.** Delete source with no supported consumer after confirming package/subpath compatibility. If checkpoint decoding remains required for a real migration, move only that required behavior under the existing explicit legacy-migration boundary and name it accordingly. Remove tests that preserve unsupported standalone APIs rather than adding documentation wrappers around dead code.

**Keep inline.** Keep the canonical table and historical migration records documented in README/schema; deleting dormant service implementations does not imply deleting retained migration tables or evidence.

**Trade-offs.** Direct unexported source-path imports are not a documented package contract, but a removal should still search scripts and downstream local consumers. Do not conflate unreachable source cleanup with deleting canonical historical rows.

**Disposition:** `campaign-ledger` — pending import into CHI-113.

### HR-007 — P3: backup list threads an unused workspace root

**Direct answer to the primary question.** The backup service signatures suggest all operations depend on the workspace root, but `listBackups` does not. A reader must trace the function to learn that list authority comes entirely from `BackupConfiguration` and `BackupObjectStore`.

**Evidence.**

- [`src/backup/service.ts:99-133`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/backup/service.ts#L99-L133) accepts `workspaceRoot` but never references it.
- [`src/cli/commands/backup.ts:95-110`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/cli/commands/backup.ts#L95-L110) resolves and threads the value through runtime construction and `listBackups`.
- By contrast, create uses the root to claim/read canonical storage in [`src/backup/service.ts:56-73`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/backup/service.ts#L56-L73), while restore uses it only for default output placement.

**Reader impact and audience.** Backup and CLI maintainers see a uniform-looking call shape that obscures different operation authority. The immediate burden is local, but it directly matches the requested parameter-threading dimension.

**Bounded recommendation.** Remove the unused list parameter and let each operation request only what it consumes. If future operations need a common resolved backup context, introduce that only when it is a real domain value, not to preserve superficial signature symmetry.

**Keep inline.** Keep limit validation and lineage walking in `listBackups`.

**Trade-offs.** This changes an internal TypeScript call signature and tests but not CLI output. Avoid replacing one unused scalar with a broader option bag.

**Disposition:** `campaign-ledger` — pending import into CHI-113.

### HR-008 — P2 duplicate: the agent lifecycle remains flat implementation prose

**Direct answer to the primary question.** The control-plane success path cannot be understood in one reading without scrolling through most of two scripts and a 342-line smoke fixture. Safety checks are present, but phases and ownership are not named at the top level.

**Fresh evidence.**

- [`ops/linear-agent/bin/run-once:12-74`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/ops/linear-agent/bin/run-once#L12-L74) loads and validates the profile plus 30 required settings.
- [`ops/linear-agent/bin/run-once:76-153`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/ops/linear-agent/bin/run-once#L76-L153) validates checkout/runtime, mutates exclusion state, acquires locks, and calculates audit/lease state.
- [`ops/linear-agent/bin/run-once:155-248`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/ops/linear-agent/bin/run-once#L155-L248) renders the envelope, builds Pi arguments, invokes the agent, interprets textual markers, updates audit state, unlocks, and dispatches systemd.
- [`ops/linear-agent/bin/verify-continuum-runtime:46-152`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/ops/linear-agent/bin/verify-continuum-runtime#L46-L152) repeats extraction/comparison mechanics for Pi MCP config, CLI runtime, Executor integration, connection address, and typed runtime.
- [`ops/linear-agent/tests/smoke.sh:1-342`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/ops/linear-agent/tests/smoke.sh#L1-L342) builds validation, installer, runtime, dispatch, dirtiness, and permission scenarios in one top-level scope.

**Reader impact and audience.** Agent-control maintainers must retain a long temporal model of environment mutation, lock ownership, prompt state, exit status, grep priority, and dispatch. Test failures identify assertions more readily than named scenarios.

**Bounded recommendation.** Preserve the executables and command order, but make the top level call named cohesive phases: validate profile, verify control checkout/runtime, acquire run state, render envelope, invoke Pi, interpret result, and dispatch. Give the verifier named checks for each representation and the smoke script named scenario functions with local fixtures. Keep phase inputs/outputs explicit and avoid a generic shell utility library.

**Trade-offs.** Shell functions can hide globals and create jump points. Each phase should be single-purpose, called once in visible order, and preserve `set -euo pipefail`, lock/unlock order, marker priority, and existing smoke cases.

**Disposition:** `duplicate` — same root finding as [CHI-110 C-003](./CHI-110-architecture-complexity-audit.md#c-003-p2-the-agent-control-lifecycle-is-flat-across-large-shell-scripts), whose campaign ledger records it as deferred because the prior human request prohibited follow-up creation. Fresh inspection confirms it remains unresolved; CHI-113 must preserve the duplicate and linked rationale rather than create a second item silently.

## 6. Positive findings worth preserving

### Explicit storage authority resolved CHI-110 C-001

`resolveStorageAuthority` visibly selects claimed, observed, or deferred modes, and each mode returns an explicit record. Claiming names identity creation and registry publication rather than hiding them behind path accessors: [`src/db/storage-authority.ts:50-111`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/db/storage-authority.ts#L50-L111). Canonical path functions are now pure over project ID and data home: [`src/db/paths.ts:52-82`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/db/paths.ts#L52-L82).

Preserve the closed modes and pure projection. HR-001 concerns how the CLI selects/uses this good boundary, not the boundary's domain model.

### One configured backup runtime resolved CHI-110 C-002

`backupRuntimeLayer` reads configuration once and supplies both `BackupConfiguration` and the bucket-specific `BackupObjectStore`: [`src/backup/runtime.ts:21-41`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/backup/runtime.ts#L21-L41). CLI operations use one named configured-operation boundary: [`src/cli/commands/backup.ts:172-187`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/cli/commands/backup.ts#L172-L187).

Preserve this explicit Effect composition and the ordered backup protocols. HR-007 is only the residual local parameter mismatch.

### Canonical migration exposes domain decisions

`prepareCanonicalDatabase` delegates path-hash upgrade, no-legacy preparation, receipt verification, lineage adoption, and migration as named safety decisions. Its helpers own cohesive snapshot, receipt, lineage, and publication mechanics. The durable no-overwrite helper centralizes publication plus directory sync without introducing a generic filesystem framework: [`src/db/storage-publication.ts:22-47`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/db/storage-publication.ts#L22-L47).

### Backup creation reads as the protocol

`createLockedBackup` exposes lock-protected local authority, snapshot, immutable object publication, head assertion, and final head publication in order. Remote identity validation remains in the remote boundary. Do not split generation, key construction, or result-shape one-liners merely to shorten the 294-line service file.

### OpenCode summarization keeps the success path above mechanics

`summarizeOpencodeSession` makes chunk planning, empty result, chunk collection, and merge decisions visible before cache and LLM mechanics. This is the desired “named domain steps” shape.

### Legacy migration dispatch is concise despite dense persistence mechanics

`migrateLegacyMemory` makes inventory, plan, dry-run, persistence authority, and ordering visible in 35 lines. The 298-line persistence module is long, but its top-level transaction dispatches artifact kinds to cohesive import functions. No separate finding was supported for that file.

### MCP read-only authority is explicit

Read-only MCP workspace resolution uses `access: 'read-only'`, verifies metadata/database presence, and does not call canonical preparation: [`src/mcp/tools.ts:122-156`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/mcp/tools.ts#L122-L156). Task read tools consistently pass `readOnlyTaskAccess`: [`src/mcp/task-read-tools.ts:14-46`](https://github.com/chrhicks/continuum/blob/736dbeca170f2ce5f3a1f51c1a30ed3675c73c85/src/mcp/task-read-tools.ts#L14-L46). Preserve that explicit split while consolidating duplicated task use cases in HR-004.

## 7. Dependency-ordered comprehension plan

This is recommendation-only; the inquiry made no product changes.

1. **HR-006: remove or explicitly relocate dormant source.** This reduces false navigation paths before maintainers refactor live memory composition.
2. **HR-002: establish one explicit memory application context.** Make scoped CLI and long-lived MCP ownership visible before changing orchestration.
3. **HR-001: expose CLI read/write authority at composition.** Build on the explicit memory context and remove ambient workspace selection.
4. **HR-003: make recall requests/dependencies and per-session outcomes closed.** Reuse the resolved application context; preserve repository replacement semantics.
5. **HR-005: express the evidence query plan and source loaders.** This is independent of recall import but should consume the same explicit handle authority.
6. **HR-004: centralize task view and validation use cases.** Preserve SDK compatibility and MCP read-only authority.
7. **HR-007: remove the unused backup list parameter.** A small independent contract cleanup.
8. **HR-008: retain the existing duplicate disposition or implement the already documented shell phase decomposition when the campaign authorizes it.** Do not create a second child for the same root finding.

Each implementation should remain a bounded child. None should absorb storage protocol changes, backup transport changes, LLM quality work, cloud mutation, credential work, or unrelated cleanup.

## 8. Adjacent observations, uncertainty, and exclusions

- The audit found no reason to reopen CHI-106 through CHI-112 correctness work. Storage and backup observations above concern comprehension only unless a later implementation issue supplies separate correctness evidence.
- A file below 300 lines is not automatically readable; conversely, the 625/641-line protocol test suites were not reported merely for length because their top-level scenario names form coherent inventories and splitting shared fixtures could add indirection.
- Database migration, snapshot durability, backup lineage, and remote verification have intrinsically complex failure paths. Their current named boundaries mostly earn that depth; this report does not recommend a generic workflow engine.
- The import-graph result is a repository-local static result from CLI/SDK roots plus direct reference searches. Before deleting HR-006 modules, an implementation child should confirm there are no unsupported local consumers importing source paths directly.
- No timed reading study or external mid-level engineer interview was performed. Severity reflects code evidence, breadth, and recurrence, not measured minutes.
- No product code, tests, follow-up Linear issues, cloud resources, credentials, deployment state, or backup objects were changed by this inquiry.

## 9. Machine-readable campaign finding ledger

The YAML block is the canonical import payload for CHI-113. It contains every finding in section 5; there is no proposal or mutation cap.

```yaml
schema: continuum-human-readability-findings/v1
source_issue: CHI-114
campaign_parent: CHI-113
baseline:
  branch: staging/xdg-storage-migration
  commit: 736dbeca170f2ce5f3a1f51c1a30ed3675c73c85
finding_policy: campaign-ledger
findings:
  - id: HR-001
    title: Expose CLI memory access policy and remove ambient workspace execution
    severity: P2
    disposition: campaign-ledger-pending
    dimensions:
      - named-domain-steps
      - mixed-abstraction
      - action-at-a-distance
      - naming
    target_audience: CLI and memory maintainers
    reader_impact: Command handlers do not reveal whether execution observes, claims, migrates, opens, or closes storage.
    evidence:
      - src/cli.ts:110-151
      - src/workspace/context.ts:3-18
      - src/cli/io.ts:150-180
      - src/cli/commands/summary.ts:21-47
    recommendation: Resolve an explicit access-mode runtime at CLI composition and pass it to handlers; separate read-only observation from writable execution without wrapping the generic renderer around authority policy.
    dependencies: []
    exclusions:
      - storage protocol changes
      - CLI output changes
  - id: HR-002
    title: Give memory application operations one explicit resource owner
    severity: P2
    disposition: campaign-ledger-pending
    dimensions:
      - parameter-threading
      - action-at-a-distance
      - temporal-coupling
    target_audience: Memory application, MCP, CLI, and test maintainers
    reader_impact: Optional repositories and global cached clients select different acquisition, migration, caching, and closing behavior outside the operation signature.
    evidence:
      - src/db/client.ts:22-84
      - src/memory/application/append.ts:34-48
      - src/memory/application/consolidate.ts:48-66
      - src/mcp/tools.ts:53-81
    recommendation: Require a resolved memory application context and make scoped CLI versus long-lived MCP composition explicit; separate test dependencies from database fallback.
    dependencies: []
    exclusions:
      - forcing one handle lifetime on every transport
      - persistence semantic changes
  - id: HR-003
    title: Separate recall import request/dependencies and return per-session outcomes
    severity: P2
    disposition: campaign-ledger-pending
    dimensions:
      - parameter-threading
      - nesting-temporal-coupling
      - action-at-a-distance
      - scrolling-navigation
    target_audience: Recall and memory maintainers
    reader_impact: Fourteen optional fields and a shared mutable accumulator require whole-file reconstruction of normal import and dry-run outcomes.
    evidence:
      - src/memory/application/recall-import.ts:25-105
      - src/memory/application/recall-import.ts:141-205
    recommendation: Use a resolved request plus required dependencies and aggregate closed per-session outcome values.
    dependencies:
      - HR-002
    exclusions:
      - summary quality changes
      - OpenCode schema changes
  - id: HR-004
    title: Centralize task view expansion and transition validation use cases
    severity: P2
    disposition: campaign-ledger-pending
    dimensions:
      - call-stack-depth
      - duplication
      - wrappers-relocation
      - naming
    target_audience: Task, SDK, CLI, and MCP maintainers
    reader_impact: Readers compare independent CLI/SDK and MCP relationship/validation implementations through mostly pass-through service wrappers.
    evidence:
      - src/cli/commands/task.ts:111-153
      - src/sdk/index.ts:122-147
      - src/mcp/task-read-tools.ts:49-135
      - src/task/tasks.service.ts:77-188
    recommendation: Add transport-neutral task-view and validation operations; keep parsing/rendering in adapters and persistence in repositories.
    dependencies: []
    exclusions:
      - public SDK behavior changes
      - generic query frameworks
  - id: HR-005
    title: Make memory evidence source and history selection an explicit query plan
    severity: P2
    disposition: campaign-ledger-pending
    dimensions:
      - mixed-abstraction
      - implementation-mechanics
      - nesting-temporal-coupling
      - action-at-a-distance
      - scrolling-navigation
    target_audience: Memory retrieval maintainers and reviewers
    reader_impact: List/search inclusion requires simulating source, tier, current/history, repeated filtering, and array mutation across modules.
    evidence:
      - src/memory/application/query.ts:26-198
      - src/memory/application/query-recall.ts:33-64
    recommendation: Build an explicit query plan, return arrays from named source loaders, and combine/filter/order once while preserving scoring inline.
    dependencies:
      - HR-002
    exclusions:
      - search ranking changes
      - generic query builders
  - id: HR-006
    title: Remove or explicitly relocate production-unreachable legacy source paths
    severity: P2
    disposition: campaign-ledger-pending
    dimensions:
      - scrolling-navigation
      - naming
      - competing-implementations
      - action-at-a-distance
    target_audience: New memory maintainers, reviewers, and coding agents
    reader_impact: Neutral source names advertise checkpoint, file-state, init, recent-entry, and JSON paths that are not on the current production graph.
    evidence:
      - src/memory/state/repository.ts:1-57
      - src/memory/state/file-repository.ts:1-136
      - src/memory/state/db-repository.ts:1-216
      - src/memory/init.ts:1-45
      - src/cli/commands/recent-entry-parser.ts:1-116
      - src/llm/json.ts:1-63
    recommendation: Delete unsupported unreachable modules, or move only genuinely required migration behavior under an explicit legacy boundary.
    dependencies: []
    exclusions:
      - deleting canonical historical rows
      - changing documented package exports
  - id: HR-007
    title: Remove the unused workspace root from backup list
    severity: P3
    disposition: campaign-ledger-pending
    dimensions:
      - parameter-threading
      - naming
    target_audience: Backup and CLI maintainers
    reader_impact: Uniform-looking signatures obscure that list authority comes only from configured services.
    evidence:
      - src/backup/service.ts:99-133
      - src/cli/commands/backup.ts:95-110
    recommendation: Remove the unused parameter and let operations request only dependencies they consume.
    dependencies: []
    exclusions:
      - backup protocol changes
      - new common option bags
  - id: HR-008
    title: Name agent runner lifecycle phases
    severity: P2
    disposition: duplicate
    duplicate_of: CHI-110/C-003
    duplicate_rationale: Fresh baseline evidence matches the same flat shell lifecycle root finding; CHI-110 records it as deferred under the prior no-follow-up instruction.
    dimensions:
      - named-domain-steps
      - mixed-abstraction
      - implementation-mechanics
      - scrolling-navigation
      - nesting-temporal-coupling
    target_audience: Linear agent control-plane maintainers
    reader_impact: The safety lifecycle requires scrolling through setup, policy, execution, marker parsing, and dispatch mechanics without named phases.
    evidence:
      - ops/linear-agent/bin/run-once:12-248
      - ops/linear-agent/bin/verify-continuum-runtime:46-152
      - ops/linear-agent/tests/smoke.sh:1-342
    recommendation: Preserve executables and order but expose named lifecycle/check phases and named smoke scenarios with explicit inputs/outputs.
    dependencies: []
    exclusions:
      - shell framework introduction
      - duplicate campaign child creation
ledger_checks:
  report_finding_count: 8
  ledger_finding_count: 8
  pending_campaign_items: 7
  duplicates: 1
  rejected: 0
  deferred_new: 0
  follow_up_issues_created: 0
  product_changes_made: 0
```

## 10. Artifact validation record

The following commands ran from the isolated CHI-114 worktree after installing the lockfile-pinned dependencies locally:

```text
/home/chicks/.bun/bin/bun run typecheck
  pass

PATH=/home/chicks/.bun/bin:$PATH bun test
  pass: 147 tests, 0 failures across 30 files

PATH=/home/chicks/.bun/bin:$PATH \
CONTINUUM_VALIDATION_BUN_BIN=/home/chicks/.bun/bin/bun \
  /home/chicks/workspaces/agents/continuum-control/ops/linear-agent/bin/validate-continuum-worktree \
  /home/chicks/workspaces/agents/continuum-control/.linear-agent-worktrees/CHI-114-human-readability-audit
  pass: typecheck, 147 tests, GOAL invariants, isolated init/task/summary/recall CLI smoke

/home/chicks/.bun/bin/bunx prettier --check \
  reviews/xdg-storage-migration/CHI-114-human-readability-audit.md
  pass

git diff --check
  pass
```

A local Python artifact check also passed:

```text
coverage dimensions: 12/12
report findings: 8
YAML ledger findings: 8
finding dispositions: 8/8
commit-pinned source links checked: 51
source link ranges: all within tracked baseline files
```

Environment note: invoking `bun test` with `/home/chicks/.bun/bin/bun` while leaving Bun absent from child `PATH` caused only spawned-CLI tests to fail with `Executable not found in $PATH: "bun"`; the required PATH-configured run above passed all 147 tests. The stable control checkout's validation helper likewise required the explicit PATH prefix even with `CONTINUUM_VALIDATION_BUN_BIN` set. No source or artifact assertion failed.

Final handoff checks must still verify the committed artifact-only diff and PR base exactly `staging/xdg-storage-migration`.
