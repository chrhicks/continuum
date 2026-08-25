# CHI-110 architecture complexity audit

## 1. Executive complexity verdict

The staged branch is **moderately complex but not broadly over-abstracted**. Its safety-critical migration and backup protocols earn most of their moving parts, and their main orchestration functions usually read as ordered domain operations. The current tip also contains the CHI-106 through CHI-109 repairs requested by the earlier CHI-105 audit.

Three maintainability findings remain. None is a newly reproduced data-safety defect or a reason to reopen CHI-105 through CHI-109:

1. storage identity, claim, and path authority are hidden behind path-looking functions;
2. backup configuration is acquired once for adapter construction and again inside every application operation; and
3. the Linear agent runner keeps its full control lifecycle in flat shell scripts.

These issues increase the chance that a future safety change is made in one path but missed in another. They should be simplified before adding more storage modes, backup transports, or agent roles. They do not justify a rewrite, a generic filesystem framework, or one-line wrapper extraction.

### Comparison and coverage

```text
repository: chrhicks/continuum
base:       e693a594b36166025b21500642093aa8d5ea0da1 (origin/master)
head:       407e48b1c30c6dbcc88452d57b1ee43351186809 (origin/staging/xdg-storage-migration)
range:      origin/master...origin/staging/xdg-storage-migration
commits:    38
files:      120
lines:      9,145 additions, 832 deletions
```

The audit covered the complete changed-file inventory and surrounding code for:

- stable XDG identity, registry claims, path-hash adoption, migration lineage, publication, receipts, and workspace fork;
- R2 configuration, Effect contracts and errors, Wrangler object storage, create/list/status/restore, and local creation locking;
- memory Effect configuration, runtime ownership, repositories, consolidation, recall, and projection flows;
- CLI, SDK, MCP read/write boundaries, task adapters, and workspace resolution;
- Linear agent profiles, runtime verification, isolated validation, systemd units, and smoke tests; and
- tests, documentation, package changes, file modes, generated-file risk, and credential-like paths.

The deduplication baseline was CHI-105, PR #15, the original `review/xdg-storage-migration` artifacts, and staged CHI-106 through CHI-109. No follow-up Linear issue was created by this audit.

## 2. Prioritized findings

### C-001 P2: path accessors hide storage identity and claim authority

**Impact.** A maintainer changing workspace discovery or storage migration must remember that functions named like path calculations may create identity metadata, publish a user-level claim, acquire a lock, or reject a copied workspace. Missing one read-only, deferred, or read-write route can reintroduce aliasing or mutation from a nominally observational command.

**Exact code.**

- `src/workspace/resolve.ts:34-59`, `resolveWorkspaceContext`
- `src/workspace/resolve.ts:128-135`, `ensureExistingStorageIdentity`
- `src/db/paths.ts:55-98`, `unclaimedProjectStorageId`, `projectStorageId`, `ensureProjectStorageId`, `canonicalProjectDir`, and `readOnlyCanonicalProjectDir`
- `src/db/paths.ts:110-152`, canonical database and receipt path accessors
- `src/db/workspace-identity.ts:45-70`, `ensureWorkspaceIdentity`
- `src/db/workspace-registry.ts:36-71`, `assertWorkspaceClaim` and `claimWorkspaceIdentity`

**Current reading path.**

```text
caller
  -> resolveWorkspaceContext({ access })
     -> maybe ensureExistingStorageIdentity
        -> ensureProjectStorageId
           -> ensureWorkspaceIdentity (may publish workspace.json)
           -> claimWorkspaceIdentity (may lock and publish registry JSON)
     -> choose one ternary branch
        deferred  -> unclaimedCanonicalDbFilePath
        read-only -> readOnlyCanonicalDbFilePath -> assertWorkspaceClaim
        read-write -> canonicalDbFilePath
                      -> canonicalProjectDir
                      -> ensure or assert identity and claim
```

The same workspace is normalized and its identity is resolved at several points. The returned `continuumDbPath` no longer reveals whether those effects already happened.

**Why it is difficult to understand.** `paths.ts` mixes pure path projection with identity creation and claim policy. The adjectives `canonical`, `readOnly`, and `unclaimed` encode three authority modes, while `resolveWorkspaceContext` encodes the same modes in an `access` option and a nested conditional. A reader has to open four files to learn whether asking for a path is safe in a read-only tool.

This is not a repeat of CHI-106's collision defect. CHI-106 correctly added the claim mechanism. The finding is the post-repair comprehension cost of placing that mechanism behind path-shaped APIs. It also refines the earlier CHI-105 composition-root observation with the now-staged identity/claim behavior.

**Bounded simplification.** Resolve storage authority once into an explicit record, for example:

```text
StorageAuthority
  workspacePath
  projectId
  dataHome
  projectDir
  dbPath
  receiptPath
  mode: claimed | observed | deferred
```

Use one named operation for claiming/creating identity and one for observation without mutation. Keep path construction as pure functions over `projectId` and `dataHome`. Let `resolveWorkspaceContext` select the authority mode once and return the resulting record or its projected paths. Pass the record into migration preparation instead of recomputing identity through multiple accessors.

**Keep inline.** Keep the `access` choice visible at the workspace composition boundary. Keep claim-lock acquisition, stale-claim checks, and no-overwrite publication inside their owning identity/registry modules.

**Extract as cohesive concepts.** Extract only storage authority resolution and pure path projection. Do not add a generic path service, filesystem abstraction, or wrappers around every `join`.

**Trade-offs and risks.** This touches many call sites and read-only tests even if behavior is preserved. It should be a dedicated refactor with copy/rename/deferred/read-only regression coverage. A poorly designed authority object could become an oversized option bag, so its modes and construction must remain closed and explicit.

### C-002 P2: backup configuration has two owners in every remote operation

**Impact.** Bucket selection is owned by CLI layer construction while project and writer identity are owned by the application operation. Every status, create, list, and restore call reads the same file twice. Future config reload, validation, or transport changes can make the adapter and operation observe different snapshots and force readers to trace both paths.

**Exact code.**

- `src/cli/commands/backup.ts:48-181`, `addStatusCommand`, `addCreateCommand`, `addListCommand`, and `addRestoreCommand`
- `src/backup/config.ts:47-65`, `readBackupConfig`
- `src/backup/service.ts:40-50`, `createBackup`
- `src/backup/service.ts:83-113`, `listBackups`
- `src/backup/service.ts:115-170`, `restoreBackup`
- `src/backup/status.ts:39-83`, `getBackupStatus`
- `src/backup/object-store.ts:34-52`, `wranglerObjectStoreLayer`

**Current reading path.**

```text
backup CLI action
  -> resolve workspace
  -> readBackupConfig for bucket
  -> build Wrangler BackupObjectStore Layer
  -> invoke status/create/list/restore
     -> readBackupConfig again for projectId and writerId
     -> yield BackupObjectStore
     -> execute protocol
```

The four CLI actions repeat that composition block with only the operation and renderer changed.

**Why it is difficult to understand.** The configuration is one authority but its fields are consumed on opposite sides of the Effect composition boundary. A reader must prove that the bucket used by the concrete object store belongs to the same config whose project and writer IDs validate remote objects. The original review's broad Effect finding was addressed by CHI-101 and included in the CHI-105 deduplication baseline; this narrower double-acquisition issue is what remains after that convergence.

**Bounded simplification.** Add one workspace-scoped backup configuration authority and one configured backup layer that acquires the config once, then supplies both the configuration and `BackupObjectStore`. The public operations should yield the already-decoded config rather than reread the file. The CLI should only select the Wrangler executable, provide the configured layer, invoke the named operation, and render its result.

Effect's `Layer.effectContext` is justified if one acquisition intentionally supplies both tags. A plain `Layer.effect` for a `BackupConfiguration` service plus a dependent object-store layer is also acceptable. Choose the shape that leaves dependency direction visible.

**Keep inline.** Keep command options and human rendering in `backup.ts`. Keep the ordered create/list/restore protocols in `backup/service.ts`; `createLockedBackup` in particular should not be split.

**Extract as cohesive concepts.** Extract configuration acquisition and adapter wiring as one runtime boundary. Do not create a generic `runConfiguredCommand` callback or wrappers for individual log lines.

**Trade-offs and risks.** One additional Context service and test layer add ceremony. The change is worthwhile only because bucket, project, and writer identity jointly define remote authority across four operations. Tests must prove one config acquisition and preserve current typed failures.

### C-003 P2: the agent control lifecycle is flat across large shell scripts

**Impact.** Changes to leases, locks, runtime verification, prompt envelopes, result markers, or dispatch require reading most of two production scripts and a 342-line smoke test. The safety properties are good, but their ownership is difficult to locate, and new roles or contract fields can be added to validation without being added to rendering or test fixtures.

**Exact code.**

- `ops/linear-agent/bin/run-once:12-74`, profile loading and 30 required settings
- `ops/linear-agent/bin/run-once:76-119`, checkout and runtime validation
- `ops/linear-agent/bin/run-once:121-153`, state, ignore rule, lock, audit, and lease preparation
- `ops/linear-agent/bin/run-once:155-204`, envelope and Pi argument construction
- `ops/linear-agent/bin/run-once:206-248`, invocation, marker interpretation, audit update, and dispatch
- `ops/linear-agent/bin/verify-continuum-runtime:46-152`, Pi MCP, CLI, Executor integration, connection, and typed-runtime comparisons
- `ops/linear-agent/tests/smoke.sh:1-342`, all validation-helper, installer, runtime, failure, live-dispatch, dirtiness, and permission scenarios

**Current reading path.**

```text
run-once
  -> source profile and validate global environment
  -> validate control checkout
  -> invoke verify-continuum-runtime
     -> compare Pi MCP config
     -> compare CLI runtime
     -> compare Executor integration metadata
     -> compare connection address
     -> compare typed MCP runtime
  -> prepare state and shared lock
  -> calculate audit and lease state
  -> render prompt envelope
  -> construct Pi argv
  -> run through timeout and tee
  -> grep text markers
  -> update audit marker and dispatch another systemd profile
```

**Why it is difficult to understand.** The top-level runner is a correct sequence, but it has no visual distinction between setup, policy, execution, and handoff. The verifier repeats extraction and comparison for three deliberately different representations without naming those checks. The smoke test builds several unrelated fixture systems in one scope, so failures identify an assertion rather than a scenario.

**Bounded simplification.** Keep the same executables and factor each into a short top-level sequence of named, cohesive phases. Suitable boundaries are profile validation, control-checkout validation, run-state acquisition, envelope rendering, Pi invocation, and result dispatch. In the verifier, name the Pi MCP, CLI runtime, Executor integration, connection, and typed-runtime checks. In `smoke.sh`, use named scenarios with fixture setup local to validation-helper, installer, runner-contract, and failure-mode tests.

**Keep inline.** Keep the actual environment names, command invocations, status checks, lock/unlock order, and marker priority visible inside the phase that owns them. Keep the top-level call order in one file.

**Extract as cohesive concepts.** Extract lifecycle phases and test scenarios only. Do not build a shell utility library, a role class hierarchy, or a generic configuration framework.

**Trade-offs and risks.** Shell functions create jump points and can hide global mutation. Each phase should be called once from the top level, have explicit input/output variables where practical, and retain `set -euo pipefail`. Refactoring the runner needs the existing dry-run, dirty-checkout, runtime-mismatch, dispatch, and permission smoke cases unchanged.

## 3. Architecture and call-flow hotspots

### Storage authority: highest concentration

The storage state machine itself is readable. The hotspot is before it: workspace discovery and path resolution now jointly own local metadata creation, claim collision policy, read-only behavior, path-hash compatibility, and pure path construction. Common task, memory, MCP, runtime, backup, and init paths enter this area through different composition roots. C-001 should be completed before adding another storage generation or authority mode.

### Agent control plane: broadest single reading path

`run-once` is the only production function, in shell form, that owns profile validation, local exclusion state, concurrency, leases, audit scheduling, prompt construction, model invocation, output interpretation, and dispatch. None of those responsibilities should move into product TypeScript, but C-003 would let the script read as a lifecycle instead of an implementation transcript.

### Backup: protocol clear, composition repeated

`createLockedBackup`, `listBackups`, `restoreBackup`, and `getBackupStatus` expose understandable success paths. The remaining hotspot is the CLI-to-Layer-to-config loop in C-002. The remote protocol and Wrangler adapter should remain separate.

### Memory: complexity mostly earned

`consolidateMemory` and recall import carry many error/result variants, test seams, and exact persistence boundaries. The staged Effect changes improve naming and typed errors. `memory/config.ts` still contains a dense precedence chain, but CHI-105 already identified its concrete redaction and malformed-file defects and the staging branch fixes those defects. This audit does not relabel the remaining explicit precedence as a new finding.

## 4. Parameter and data-flow hotspots

| Hotspot               | Origin                                                                     | Transformations and authority                                                                                                               | Why it matters                                                                                                       |
| --------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Workspace `access`    | CLI/MCP/runtime caller                                                     | `read-write`, `read-only`, or `deferred` selects identity creation, claim assertion, or unclaimed lookup across `resolve.ts` and `paths.ts` | One small option controls filesystem and registry effects that are not visible in the returned path                  |
| Backup config         | `.continuum/r2-backup.json`                                                | CLI consumes bucket to construct a Layer; application rereads project/writer IDs                                                            | One authority crosses the composition boundary twice                                                                 |
| Agent profile         | private environment file                                                   | More than 30 globals feed validation, runtime verification, state paths, prompt prose, Pi argv, and dispatch                                | There is no intermediate validated contract, so consumers are distributed through the script                         |
| Migration authority   | workspace identity, old path-hash DB, legacy DB, receipt, embedded lineage | `prepareCanonicalDatabase` resolves explicit states and delegates to focused operations                                                     | Complex but appropriately explicit; preserve this shape                                                              |
| Recall import options | CLI/test inputs                                                            | Optional extractor, repository, summarizer, clock, paths, filters, and dry-run seams                                                        | Wide, but mostly intentional injection for deterministic boundary tests; not a branch-specific simplification target |

Avoid replacing these with vague option bags. C-001 and C-002 should use explicit domain records or services with closed authority modes.

## 5. Positive examples worth preserving

### `createLockedBackup` reads as the remote protocol

`src/backup/service.ts:52-81` performs canonical preparation, snapshot, initial head read, generation and manifest construction, immutable uploads, head assertion, and publication in order. Each helper hides a real protocol concept. Keep the success path in one function; do not extract object-key or return-shape one-liners merely to shorten it.

### `prepareCanonicalDatabase` exposes the migration state machine

`src/db/storage.ts:41-82` names path-hash adoption, no-legacy handling, receipt verification, lineage adoption, initialization refusal, and migration. The branch conditions are domain decisions rather than low-level filesystem mechanics. Moving them into a generic workflow engine would make the safety model harder to audit.

### Durable no-overwrite publication is a deep helper

`src/db/storage-publication.ts:25-48` owns hard-link publication, idempotent-existing detection, destination-directory fsync, and descriptor cleanup. CHI-107 put one durability rule in one place without hiding caller-specific conflict checks. This is the right kind of extraction.

### Workspace fork is a readable multi-artifact operation

`src/db/workspace-fork.ts:46-96` names source verification, new identity allocation, staged snapshot creation, publication, legacy recheck, identity replacement, and claim publication. Its ordering should remain visible even if C-001 changes the authority values it consumes.

### Read-only MCP task paths have explicit authority

`src/mcp/task-read-tools.ts:14-174` consistently resolves through `resolveReadOnlyMcpWorkspace` and passes `readOnlyTaskAccess` to task services. The write adapters remain in `task-tools.ts`. The split follows authority, not arbitrary file length.

### Backup status models remote failure as data

`src/backup/status.ts:39-83` keeps local snapshot failures typed while converting remote availability failures into the observable `remote-error` status. The main path is visible before classification details, and the returned record makes data origin clear.

## 6. Dependency-ordered simplification plan

1. **Make storage authority explicit (C-001).** Introduce the authority record and separate claim from observation while preserving every copy, rename, path-hash upgrade, read-only MCP, deferred CLI, and migration test. This establishes the stable workspace value that later composition roots should consume.
2. **Unify backup configuration acquisition (C-002).** Build the configured backup Layer from the resolved workspace authority. Keep the service protocols unchanged and prove one decoded config supplies bucket, project, and writer identity.
3. **Decompose agent lifecycle phases (C-003).** This is independent of product storage after the runtime contract fields are stable. Refactor one script and its named smoke scenarios at a time; preserve command order and failure codes.
4. **Re-run the complete staging gate after each change.** Use focused storage, backup, and agent smoke tests plus the configured isolated validation helper. Do not combine these recommendations into one cleanup PR.

The plan intentionally excludes CHI-105 through CHI-109 behavior, product rewrites, new transports, a generic filesystem layer, arbitrary helper extraction, follow-up issue creation, deployment, and cloud mutation.
