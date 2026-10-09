# CHI-204: XDG storage migration documentation and examples audit

## 1. Verdict

**Primary question:** Can a reader of the public README, documentation, examples, and CLI help determine the supported XDG storage layout and the correct, safe action for initialization, migration, rename, copy, fork, read-only/deferred use, interruption, and recovery without inferring behavior from source code?

**Answer: not yet.** The staged implementation has strong safety properties, and the README accurately describes the core UUID-backed layout and legacy SQLite snapshot mechanism. However, the public surface does not yet form an operator-complete contract. It contains one direct identity contradiction, labels a provisional pre-initialization path as canonical, omits the same-data-home boundary around rename/copy/fork, does not explain which read-looking operations may claim or migrate storage, and provides no supported reconciliation procedure for several fail-closed migration states. CLI help and init output do not close those gaps. The runnable SDK examples also leave durable XDG state without saying so.

This is a **report-only** inquiry. All eight findings below have disposition `report-only`; no follow-up issue was created and no product, documentation, test, prompt, or configuration file was changed.

## 2. Baseline and scope

```text
repository:  https://github.com/chrhicks/continuum
branch:      staging/xdg-storage-migration
commit:      2ec1fc57b2800a6b0defcbc5291883041624bdb2
master:      f6b63e5 (comparison ref after fetch on 2026-10-09)
issue:       CHI-204
policy:      report-only
```

The audit covered:

- every tracked Markdown path, with storage-relevant claims inspected in `README.md`, `docs/R2-BACKUP-DESIGN.md`, `skills/continuum/SKILL.md`, the Linear-agent operational docs, contribution/repository guidance, plans, and prior staged review artifacts;
- the complete CLI command/help tree relevant to storage: root, `init`, `runtime`, `workspace`, `workspace fork`, `memory`, `memory migrate`, `summary`, `mcp`, and all backup subcommands;
- the repository's runnable SDK examples under `scripts/` and the absence of a separate `examples/` tree;
- workspace resolution, XDG path selection, UUID/path-hash authority, identity claims, legacy and path-hash migration, lineage, receipts, publication, fork, CLI/MCP composition, SDK initialization, and their focused tests;
- `origin/master...2ec1fc57` to distinguish staged XDG documentation from pre-existing text.

R2 behavior was inspected only where its documentation makes claims about local XDG identity, movement, recovery, or canonical authority. Unrelated task, graph, backup-provider, and memory-quality semantics were excluded.

## 3. Public journey map

| Journey                                          | What the public surface currently tells a reader                                                                                                     | Verified behavior                                                                                                                                                                        | Result                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Fresh initialization                             | Quick Start says run `continuum init`; README gives the UUID path and XDG default.                                                                   | Init creates `.continuum/workspace.json`, a UUID-keyed database, and a user-level workspace claim.                                                                                       | Core happy path is accurate.                                               |
| Pre-init inspection                              | `runtime` reports the “canonical database path” without writing.                                                                                     | It reports a normalized-path SHA-256 candidate until init creates a UUID; the path changes after init.                                                                                   | Finding DOC-003.                                                           |
| Workspace/root selection                         | `--cwd` and upward `.continuum`/`.git` discovery are documented.                                                                                     | Focused tests confirm both. MCP init intentionally initializes the exact absolute path.                                                                                                  | No finding.                                                                |
| Project-local legacy DB                          | README says `continuum init` snapshots `.continuum/continuum.db`, includes WAL-visible data, preserves source, embeds lineage, and writes a receipt. | Implementation and tests agree.                                                                                                                                                          | Safety claims accurate; outcome/recovery UX incomplete (DOC-002, DOC-006). |
| Old path-hash XDG DB                             | README says it is copied once to UUID storage and retained.                                                                                          | Any writable canonical-preparation path can trigger the upgrade; old storage is retained with embedded lineage but no new UUID-side removal receipt for that old XDG path.               | Finding DOC-005.                                                           |
| Same-data-home rename                            | README says rename retains the same canonical DB.                                                                                                    | The moved `.continuum/workspace.json` retains the UUID and a stale claim is adopted when the old path no longer exists.                                                                  | Accurate only inside one effective XDG data home (DOC-001).                |
| Same-data-home filesystem copy                   | README warns that the identity is copied and concurrent use is not synchronization.                                                                  | A live-copy collision fails before shared DB mutation and directs the user to `workspace fork`; fork snapshots into a new UUID DB.                                                       | Safety works; prerequisites and safe procedure are undocumented (DOC-001). |
| Git clone / copy without ignored metadata        | No distinction from “copying a workspace.”                                                                                                           | `.continuum/` is ignored, so a normal clone gets a fresh identity and empty canonical DB on init.                                                                                        | Finding DOC-001.                                                           |
| Copy/move to another machine or XDG root         | No boundary is stated.                                                                                                                               | The UUID metadata points into the new data root, where the canonical DB is absent; `workspace fork` cannot snapshot the missing source.                                                  | Finding DOC-001.                                                           |
| MCP read-only use                                | README lists MCP capabilities but does not identify the read-only set or its initialization/migration contract.                                      | Advertised read tools preserve bytes/metadata and fail closed when init/schema migration is required.                                                                                    | Finding DOC-004.                                                           |
| CLI read-looking use                             | Only `runtime` is explicitly documented as read-only.                                                                                                | `memory search` and `summary` use claim/migrate-scoped access; a fresh `memory search` creates identity, claim, and canonical DB.                                                        | Finding DOC-004.                                                           |
| Deferred inspection                              | Not explained publicly as a mode.                                                                                                                    | `runtime` resolves a non-writing deferred authority; before identity exists it uses the path hash.                                                                                       | Findings DOC-003 and DOC-004.                                              |
| Receipt-loss interruption                        | README says embedded lineage permits receipt recovery.                                                                                               | A retry adopts the lineage-bearing destination and republishes the receipt.                                                                                                              | Accurate.                                                                  |
| Divergence/malformed/missing migration artifacts | README promises actionable diagnostics.                                                                                                              | Operations fail closed and preserve data, but several messages only say to “reconcile explicitly” or identify a missing/unreadable artifact; no supported reconciliation runbook exists. | Finding DOC-002.                                                           |
| Legacy Markdown import                           | README and help call `memory migrate` a Markdown import and expose `--dry-run`.                                                                      | This is distinct from the automatic SQLite storage cutover.                                                                                                                              | No terminology finding.                                                    |
| SDK examples                                     | Examples call `continuum.task.init()` in `.tmp` workspaces and some advertise `--cleanup`.                                                           | Canonical DBs live under the caller's XDG root; cleanup soft-deletes tasks but leaves workspace identity and DB.                                                                         | Finding DOC-008.                                                           |

## 4. Prioritized findings

### DOC-001 — P1 — Rename, copy, clone, and fork guidance omits the storage-root boundary

**Classification:** documentation omission; supported behavior is incompletely documented

**Disposition:** `report-only`

README states that a UUID in `.continuum/workspace.json` makes moving or renaming retain the database, and that copying a workspace copies its identity ([README.md:134](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/README.md#L134)). It does not say that these claims require the same effective `XDG_DATA_HOME` and the copied/moved `.continuum/workspace.json` metadata. `.continuum/` is ignored, so a normal Git clone is not the “copy” described there ([.gitignore:5-7](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/.gitignore#L5-L7)).

The fork implementation resolves the source DB by combining the copied UUID with the **current** data home and fails if that file is absent ([src/db/workspace-fork.ts:55-68](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/src/db/workspace-fork.ts#L55-L68)). A same-data-home copy is safely rejected while the original remains live, and the diagnostic directs the user to fork ([src/db/storage-errors.ts:50-59](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/src/db/storage-errors.ts#L50-L59)); the focused copy/fork and rename scenarios pass ([tests/storage-migration.test.ts:374-500](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/tests/storage-migration.test.ts#L374-L500)).

The disposable reproduction confirmed three different outcomes:

1. rename within one XDG root retained the UUID DB and data;
2. `cp -a` within that root produced `STORAGE_WORKSPACE_COLLISION`, then `workspace fork` succeeded and retained the copied data;
3. the same copied metadata under a second XDG root made `workspace fork` fail because the UUID DB was missing.

A Git-clone-shaped directory without `.continuum/` initialized a new UUID and empty DB. A reader cannot derive those distinctions from “moving,” “renaming,” and “copying.” This creates a data-continuity risk when moving between machines, accounts, containers, or XDG roots.

**Documentation needed:** a journey table that distinguishes same-root rename, same-root filesystem copy, Git clone, and cross-root/machine transfer; names the files that must move; states fork prerequisites and irreversible result; tells the user to verify `--cwd`, `dataHome`, and source DB before forking; and links cross-machine recovery to an explicit export/backup/restore procedure rather than implying local UUID metadata is sufficient.

### DOC-002 — P1 — Fail-closed migration states have no supported reconciliation or recovery runbook

**Classification:** documentation defect plus undocumented recovery behavior

**Disposition:** `report-only`

README says changed sources, replaced destinations, and unproven divergence fail with “actionable diagnostics,” and that embedded lineage recovers receipt-loss interruptions ([README.md:136](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/README.md#L136)). Receipt-loss recovery is real: a destination with matching embedded lineage is adopted and the receipt is recreated ([src/db/storage-canonical.ts:87-98](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/src/db/storage-canonical.ts#L87-L98); [tests/storage-migration.test.ts:230-263](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/tests/storage-migration.test.ts#L230-L263)).

Other states are safe but not actionable:

- generic divergence says only “reconcile them explicitly before retrying” ([src/db/storage-errors.ts:27-36](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/src/db/storage-errors.ts#L27-L36));
- a receipt with a missing canonical DB reports the missing file but no supported recovery action ([src/db/storage-canonical.ts:64-81](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/src/db/storage-canonical.ts#L64-L81));
- malformed identity, receipt, or claim files fail as unreadable without a repair procedure;
- changed legacy state correctly refuses the “removable” claim, but there is no documented compare/export/choose flow;
- the README explains automatic receipt recovery but not what interruption points are automatically retryable versus human-blocking.

The focused suite verifies non-overwrite safety for changed source, unrelated replacement with/without legacy source, path-hash replacement, publication sync failure, and receipt loss ([tests/storage-migration.test.ts:93-372](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/tests/storage-migration.test.ts#L93-L372)). The defect is not silent mutation; it is that an operator cannot determine the supported safe next step without reading internals or inventing a SQLite reconciliation process.

**Documentation needed:** a state/error table keyed by stable error code and artifact presence, with “stop writes,” preservation/copy commands, exact retry-safe cases, verification commands, and escalation/manual-reconciliation boundaries. Do not prescribe deletion or replacement where the product has no supported proof.

### DOC-003 — P2 — `runtime` calls a pre-init path canonical even though init changes it

**Classification:** documentation/output terminology mismatch

**Disposition:** `report-only`

README tells automation that `continuum runtime` reports the canonical DB path without initializing storage ([README.md:41-45](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/README.md#L41-L45)). Before workspace identity exists, deferred/read-only authority substitutes the normalized-path SHA-256 value ([src/db/storage-authority.ts:90-111](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/src/db/storage-authority.ts#L90-L111)). Init then creates a random UUID and therefore a different DB path ([src/db/storage-authority.ts:79-87](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/src/db/storage-authority.ts#L79-L87)).

The reproduction observed a 64-hex `runtime.data.database` before init and a different UUID directory after init. The runtime test verifies only that the pre-init path is non-writing, not that it remains canonical after init ([tests/runtime-command.test.ts:32-63](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/tests/runtime-command.test.ts#L32-L63)). The same output always labels its generation `xdg-project-sha256-v1` ([src/db/paths.ts:6](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/src/db/paths.ts#L6); [src/runtime/contract.ts:16-31](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/src/runtime/contract.ts#L16-L31)), even though initialized authority is UUID-backed.

Automation may incorrectly cache, permission, monitor, or compare a path that will never hold the initialized DB. The read-only/no-write guarantee is accurate; the stability and “canonical” terminology are not.

**Documentation needed:** call the no-identity value a provisional/candidate path, document that init changes it, expose or explain initialization/identity state, and align the public storage-generation name with the actual UUID generation or explicitly define why the legacy name remains stable.

### DOC-004 — P2 — Read-only and deferred storage modes are not mapped to public operations

**Classification:** documentation omission; behavior is merely undocumented

**Disposition:** `report-only`

README explicitly calls only `runtime` read-only and otherwise lists MCP capabilities without naming the read-only set or their fail-closed contract ([README.md:41-56](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/README.md#L41-L56)). The repository actually has three authority modes—claimed, observed, and deferred ([src/db/storage-authority.ts:21-61](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/src/db/storage-authority.ts#L21-L61)).

MCP read tools use observed/read-only authority, require identity/current schema, and direct the caller to init with write approval rather than migrating ([src/mcp/tools.ts:119-147](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/src/mcp/tools.ts#L119-L147); [src/db/client.ts:34-59](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/src/db/client.ts#L34-L59)). All advertised read tools preserve storage and fail closed for missing/current-migration/legacy states in focused tests ([tests/mcp-read-only.test.ts:81-239](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/tests/mcp-read-only.test.ts#L81-L239)).

By contrast, CLI `memory search` uses `claim-migrate-scoped` access ([src/cli/commands/memory/search-handler.ts:13-26](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/src/cli/commands/memory/search-handler.ts#L13-L26)), and the common runner claims authority and prepares canonical migration before executing ([src/cli/io.ts:137-174](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/src/cli/io.ts#L137-L174)). A disposable `memory search absent` against a fresh `.git` workspace succeeded and created `.continuum/workspace.json`, a workspace claim, and a UUID canonical DB. `memory migrate --dry-run` is a special non-claiming inspection path, but help describes only “Inventory without writing,” not the broader authority distinction.

A read-only filesystem/operator cannot tell from the docs whether to use CLI or MCP, which apparent reads can initialize or migrate, or why the same logical read succeeds/fails differently.

**Documentation needed:** an operation/access matrix for CLI and MCP: no-write deferred diagnostics, true read-only observed tools, writable claiming operations, auto-schema/path-hash migration behavior, and commands requiring a prior write-approved init.

### DOC-005 — P2 — The path-hash-to-UUID migration lacks trigger, verification, and cleanup guidance

**Classification:** documentation omission

**Disposition:** `report-only`

README says old SHA-256 path storage is “copied once into UUID storage without overwriting or deleting” it ([README.md:134](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/README.md#L134)). It does not say:

- which command triggers that copy;
- that canonical preparation checks and upgrades path-hash storage before the legacy-local-DB init gate ([src/db/storage.ts:39-76](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/src/db/storage.ts#L39-L76));
- how to identify old and new paths;
- how to verify embedded path-hash lineage;
- whether or when the retained old XDG DB is removable.

Focused tests show the UUID DB receives future writes while the old path-hash DB remains unchanged, retries are idempotent, prior legacy lineage can carry forward, and a replaced old DB fails closed ([tests/storage-migration.test.ts:265-372](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/tests/storage-migration.test.ts#L265-L372)). Unlike project-local legacy migration, this path does not publish a new receipt or warning that calls the old XDG file removable. Retention is safe, but operators cannot determine result or cleanup policy from docs/help.

**Documentation needed:** identify the automatic trigger, old/new layouts, expected retained artifacts, verification command/output, idempotent retry behavior, and an explicit “retain indefinitely” rule unless a supported removal proof is intentionally provided.

### DOC-006 — P2 — `init` help and output do not report the migration outcome they are the entry point for

**Classification:** CLI-help/output defect

**Disposition:** `report-only`

`continuum init --help` only says “Initialize continuum database in current directory.” Root help and `continuum guide` contain no XDG, identity, migration, fork, interruption, or recovery guidance. The implementation's canonical preparation returns `created`, `migrated`, legacy source state, source path, destination path, and receipt path ([src/db/storage-model.ts:6-13](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/src/db/storage-model.ts#L6-L13)), but SDK/CLI init reduces this to generic initialized/created booleans ([src/sdk/index.ts:45-61](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/src/sdk/index.ts#L45-L61); [src/cli.ts:72-98](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/src/cli.ts#L72-L98)).

A legacy-DB JSON reproduction returned `created: true` but did not identify that migration occurred or provide source/destination/receipt paths. The only migration-specific result was an unstructured stderr warning saying the exact source may be removed manually. There is no documented post-init verification command or explanation of mixed stdout/stderr for automation.

The migration itself succeeded safely; the defect is observability. An operator cannot tell fresh creation from legacy cutover from the JSON contract, locate the receipt, or record a reproducible migration result without filesystem/source inference.

**Documentation/help needed:** explain init's fresh, legacy-local, and prior-path-hash outcomes; document stderr versus JSON; provide exact verification steps using stable output; and make `init --help`/guide point to the migration and recovery section.

### DOC-007 — P2 — The R2 design still says local XDG identity is path-hash based

**Classification:** stale contradictory documentation

**Disposition:** `report-only`

The R2 design states, “The local path hash used for XDG storage is deliberately not reused” ([docs/R2-BACKUP-DESIGN.md:28](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/docs/R2-BACKUP-DESIGN.md#L28)). The current README says the active local project ID is a UUID in `.continuum/workspace.json` and path-hash storage is only an older generation ([README.md:134](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/README.md#L134)). Current claimed authority uses that UUID ([src/db/storage-authority.ts:79-87](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/src/db/storage-authority.ts#L79-L87)).

The intended R2 point—that backup's portable project/writer IDs are a separate contract—is still valid. The local-identity premise is stale and makes cross-machine movement more confusing precisely where the document discusses portability.

**Documentation needed:** replace the path-hash statement with the current local UUID/claim model, distinguish local workspace UUID from R2 portable project/writer IDs, and cross-link the supported cross-machine recovery path.

### DOC-008 — P3 — Runnable SDK examples leave durable XDG state and overstate cleanup

**Classification:** example omission

**Disposition:** `report-only`

The three SDK scripts default to project-local `.tmp/...` directories, change into them, and call `continuum.task.init()` ([scripts/sdk-smoke.ts:15-30](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/scripts/sdk-smoke.ts#L15-L30); [scripts/sdk-lifecycle.ts:15-26](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/scripts/sdk-lifecycle.ts#L15-L26); [scripts/sdk-backlog-bootstrap.ts:15-26](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/scripts/sdk-backlog-bootstrap.ts#L15-L26)). Under the staged layout, the DB is not contained by that `.tmp` directory; it is created under the caller's normal XDG data root. The lifecycle/backlog `--cleanup` paths only soft-delete tasks ([scripts/sdk-lifecycle.ts:95-102](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/scripts/sdk-lifecycle.ts#L95-L102); [scripts/sdk-backlog-bootstrap.ts:72-78](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/scripts/sdk-backlog-bootstrap.ts#L72-L78)); identity, claims, DB, and deleted rows remain. `sdk-smoke` has `--keep` but no full-storage cleanup.

The examples are behaviorally valid, but their location and cleanup labels imply isolation they no longer provide. Repeated development runs can accumulate durable XDG projects.

**Example guidance needed:** run examples with an explicit temporary `HOME`/`XDG_DATA_HOME`, print the resolved runtime/database, describe task cleanup as logical rather than storage cleanup, and provide a safe disposable-directory teardown in the script documentation.

## 5. Explicit no-finding areas

1. **Default layout and fallback:** `${XDG_DATA_HOME}/continuum/projects/<uuid>/continuum.db` after initialization and `$HOME/.local/share` fallback match implementation ([src/db/paths.ts:31-35](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/src/db/paths.ts#L31-L35)).
2. **Workspace discovery:** upward resolution to `.continuum` or `.git` and explicit `--cwd` behavior match README and focused tests ([tests/workspace.test.ts:30-86](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/tests/workspace.test.ts#L30-L86)).
3. **Legacy snapshot safety:** WAL-visible data is serialized, integrity checked, published without overwrite, source retained, and future writes avoid the legacy DB. The focused migration test passes ([tests/storage-migration.test.ts:48-91](https://github.com/chrhicks/continuum/blob/2ec1fc57b2800a6b0defcbc5291883041624bdb2/tests/storage-migration.test.ts#L48-L91)).
4. **Receipt-loss recovery:** embedded lineage enables idempotent receipt recreation after publication interruption, as README claims.
5. **Divergence safety:** every inspected divergent/replaced-source scenario fails closed without overwriting either database. DOC-002 concerns the missing operator procedure, not unsafe automatic behavior.
6. **Same-root rename/copy implementation:** rename adoption, copy collision, serialized claims, and explicit same-data-home fork all pass. DOC-001 concerns omitted boundaries and procedure.
7. **MCP read-only implementation:** advertised read tools preserve storage bytes/metadata and fail closed. DOC-004 concerns discoverability and CLI/MCP semantic differences.
8. **Migration terminology:** `memory migrate` is consistently described as legacy Markdown import, distinct from SQLite storage migration.
9. **Generated Markdown:** README correctly describes `.continuum/memory/` as project-local, non-authoritative projection state.
10. **Backup interruption guidance:** the R2 document gives a concrete lock/orphan recovery procedure. No additional local-XDG finding arose beyond stale identity terminology in DOC-007.

## 6. Coverage ledger

| Requested dimension                           | Coverage and conclusion                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminology                                   | DOC-003 (`canonical`, `sha256` generation) and DOC-007 (stale local path-hash claim). `memory migrate` terminology has no finding.                                              |
| Defaults                                      | XDG and HOME defaults verified with no finding; SDK examples fail to isolate the default (DOC-008).                                                                             |
| Identity guarantees                           | Fresh UUID, path-hash compatibility, claims, rename, copy, clone, fork, and R2/local identity covered by DOC-001, DOC-003, DOC-005, DOC-007.                                    |
| Happy paths                                   | Fresh init and same-root rename/fork verified; missing output/help is DOC-006.                                                                                                  |
| Error guidance                                | Collision guidance is locally useful; migration divergence/missing/unreadable states lack a runbook (DOC-002).                                                                  |
| Recovery/interruption                         | Receipt-loss and publication retry verified; unsupported/manual states mapped in DOC-002. R2 lock/orphan guidance checked with no additional finding.                           |
| Environment/path assumptions                  | Same `XDG_DATA_HOME`, ignored `.continuum`, clone versus copy, and external SDK-example state covered by DOC-001 and DOC-008.                                                   |
| Read-only mode                                | MCP observed/read-only tools and schema/init failures covered by DOC-004 and focused tests.                                                                                     |
| Deferred mode                                 | Non-writing runtime and provisional path-hash fallback covered by DOC-003/DOC-004.                                                                                              |
| Stale/contradictory examples                  | R2 identity sentence is stale (DOC-007); SDK cleanup/isolation is incomplete (DOC-008).                                                                                         |
| Omissions                                     | Operator matrices and post-init verification are missing (DOC-001, DOC-002, DOC-004, DOC-005, DOC-006).                                                                         |
| CLI help                                      | Full relevant help tree inspected; storage journey/recovery discovery is absent and captured in DOC-001/002/004/006.                                                            |
| New-user safe next step                       | Quick Start works for fresh state. Copy/move, read-only operation, migration conflict, and verification do not supply a complete safe next step (DOC-001/002/004/006).          |
| Documentation defect vs undocumented behavior | Each finding explicitly classifies contradiction/output defect versus behavior that is safe but undocumented.                                                                   |
| Master drift                                  | Master describes project-local `.continuum/continuum.db`; staged README introduces the XDG/UUID paragraphs. Findings concern the staged contract, not inherited master wording. |

## 7. Complete disposition ledger

```yaml
policy: report-only
findings:
  - id: DOC-001
    priority: P1
    disposition: report-only
    class: documentation-omission
  - id: DOC-002
    priority: P1
    disposition: report-only
    class: documentation-and-recovery-guidance-defect
  - id: DOC-003
    priority: P2
    disposition: report-only
    class: documentation-output-terminology-mismatch
  - id: DOC-004
    priority: P2
    disposition: report-only
    class: undocumented-access-mode-behavior
  - id: DOC-005
    priority: P2
    disposition: report-only
    class: undocumented-migration-journey
  - id: DOC-006
    priority: P2
    disposition: report-only
    class: cli-help-and-output-defect
  - id: DOC-007
    priority: P2
    disposition: report-only
    class: stale-contradictory-documentation
  - id: DOC-008
    priority: P3
    disposition: report-only
    class: example-isolation-omission
follow_up_issues_created: 0
product_mutations: 0
```

## 8. Reproduction and validation

All behavioral reproductions used disposable directories under the isolated worktree's `.tmp/` directory with explicit temporary `HOME` and `XDG_DATA_HOME`; they were removed after inspection. No cloud, credential, backup, deployment, or durable product data was touched.

Commands used:

```sh
git rev-parse HEAD
git diff --name-status origin/master...HEAD
git ls-files '*.md'
rg -n -i 'xdg|storage|identity|migration|rename|copy|fork|read.only|defer|interrupt|recover' \
  --glob '*.md' .

/home/chicks/.bun/bin/bun run bin/continuum --help
/home/chicks/.bun/bin/bun run bin/continuum init --help
/home/chicks/.bun/bin/bun run bin/continuum runtime --help
/home/chicks/.bun/bin/bun run bin/continuum workspace --help
/home/chicks/.bun/bin/bun run bin/continuum workspace fork --help
/home/chicks/.bun/bin/bun run bin/continuum memory migrate --help
/home/chicks/.bun/bin/bun run bin/continuum guide

PATH="$HOME/.bun/bin:$PATH" /home/chicks/.bun/bin/bun test \
  tests/storage-migration.test.ts \
  tests/storage-receipt.test.ts \
  tests/workspace.test.ts \
  tests/runtime-command.test.ts \
  tests/mcp-read-only.test.ts \
  tests/memory-cli-cutover.test.ts
# 37 pass, 0 fail, 261 expect() calls
```

The final artifact validation also runs formatting check, link/range checks, diff inspection, the repository validation gate, and the configured isolated Continuum validation helper. The durable Continuum record ID and final PR are recorded in the Linear completion comment.

## 9. Scope and mutation check

- Product source changed: **no**
- README/docs/examples changed: **no**
- Tests/prompts/config changed: **no**
- Follow-up Linear issues created: **no**
- Cloud/deployment/credential/billing mutation: **no**
- Inquiry artifact added: **this file only**
- Durable execution context: Continuum task `tkt-6fwr1y6b`
