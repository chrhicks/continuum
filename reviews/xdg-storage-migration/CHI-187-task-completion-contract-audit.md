# CHI-187 task completion contract audit

## 1. Executive answer

**Primary question:** Do all supported task mutation paths enforce one authoritative completion contract, or can create/update bypass the dedicated completion invariants?

**Answer: no.** Creation and generic update can persist `status: completed` through every public transport without completion readiness, an outcome, or an open-blocker check. The dedicated completion operation rejects open blockers, but it does not enforce the field-readiness result returned by `validateTransition`, and its non-empty outcome guarantee exists only inconsistently at adapter boundaries. Completion timestamps and retained outcomes also depend on which mutation path was used.

Five evidence-backed findings explain the verdict:

1. create and generic update bypass completion invariants through SDK, CLI, and MCP;
2. dedicated completion treats readiness validation as advisory, not authoritative;
3. the non-empty outcome rule has no shared owner and differs by transport;
4. completion metadata can be reset, cleared, or reused independently of the outcome; and
5. tests and guidance demonstrate the preferred workflow but do not protect the persisted invariant.

All findings have the required **`report-only`** disposition. This inquiry made no product or test implementation change and created no follow-up issue.

## 2. Inspected source range and method

### Baseline

```text
repository: chrhicks/continuum
branch:     staging/xdg-storage-migration
commit:     306dcac04d2bab3ea0b52df2596265d83227a183
worktree:   .linear-agent-worktrees/CHI-187
```

Every source link is pinned to that exact staging commit.

### Method

The audit:

- traced task creation, generic update, transition readiness, and dedicated completion from repository/service boundaries through SDK, CLI, and MCP;
- inspected task input types, schemas, mappers, error paths, timestamp writes, focused tests, and the task guide;
- compared CHI-121, CHI-160, CHI-165, CHI-166, CHI-182, and CHI-183 plus their Continuum history to separate this contract defect from adjacent staged work;
- ran one temporary, uncommitted matrix against fresh SDK, CLI, and real stdio MCP workspaces; and
- ran all focused task, SDK, and MCP tests.

The reproduction created only disposable workspaces under `/tmp` and removed them. It did not mutate canonical task data, product source, cloud resources, credentials, deployment state, migrations, backups, or storage authority.

## 3. Current mutation and validation flow

```text
SDK create/update ─┐
CLI create/update ─┼─> create_task / update_task ─> persist completed directly
MCP create/update ─┘

SDK validate ─┐
CLI validate ─┼─> validate_task_transition_for_directory
MCP validate ─┘      -> report missing fields + open blockers, read-only

SDK complete ─┐
CLI complete ─┼─> complete_task
MCP complete ─┘      -> reject open blockers
                       -> write completed + supplied outcome + timestamp
                       -> does not consume readiness result
```

The repository accepts terminal status on create, derives `completed_at`, and always stores `outcome: null`: [`src/task/tasks.repository.ts:124-169`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/src/task/tasks.repository.ts#L124-L169). Generic update applies status and timestamp changes without calling blocker or readiness validation: [`src/task/tasks.repository.ts:179-225`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/src/task/tasks.repository.ts#L179-L225) and [`src/task/tasks.repository.update.ts:44-60`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/src/task/tasks.repository.update.ts#L44-L60).

Readiness is a separate read-only operation that returns missing fields and, only for a completed target, open blockers: [`src/task/task-inspection.service.ts:69-84`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/src/task/task-inspection.service.ts#L69-L84). The underlying readiness rule requires description and, for feature/bug/investigation/chore, plan: [`src/task/validation.ts:29-47`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/src/task/validation.ts#L29-L47).

Dedicated completion alone checks `has_open_blockers`, then writes the caller's outcome and a fresh timestamp: [`src/task/tasks.repository.ts:109-121`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/src/task/tasks.repository.ts#L109-L121) and [`src/task/tasks.repository.ts:252-274`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/src/task/tasks.repository.ts#L252-L274). It does not call the readiness rule.

## 4. Path-by-path evidence

| Public path                          | Can request `completed`? | Readiness enforced at write? | Open blockers rejected? | Outcome required at authoritative write?          | Observed result                                                     |
| ------------------------------------ | ------------------------ | ---------------------------- | ----------------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| SDK `task.create`                    | yes                      | no                           | no                      | no outcome field exists                           | accepted completed + open blocker + `outcome: null`                 |
| SDK `task.update`                    | yes                      | no                           | no                      | no outcome field exists                           | accepted invalid direct transition                                  |
| SDK `task.complete`                  | dedicated                | no                           | **yes**                 | TypeScript string only; empty accepted at runtime | accepted missing fields and empty outcome                           |
| CLI `task create --status completed` | yes                      | no                           | no                      | no outcome option                                 | accepted completed + open blocker + `outcome: null`                 |
| CLI `task update --status completed` | yes                      | no                           | no                      | no outcome option                                 | accepted invalid direct transition                                  |
| CLI `task complete`                  | dedicated                | no                           | **yes**                 | adapter trims and rejects empty/whitespace        | accepted missing fields; rejected whitespace outcome before service |
| MCP `continuum_task_create`          | yes                      | no                           | no                      | no outcome property                               | accepted completed + open blocker + `outcome: null`                 |
| MCP `continuum_task_update`          | yes                      | no                           | no                      | no outcome property                               | accepted invalid direct transition                                  |
| MCP `continuum_task_complete`        | dedicated                | no                           | **yes**                 | schema requires length 1, not non-whitespace      | accepted missing fields and whitespace-only outcome                 |

SDK create/update/complete are thin mappings to the same three service operations: [`src/sdk/index.ts:89-115`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/src/sdk/index.ts#L89-L115) and [`src/sdk/mappers.ts:112-140`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/src/sdk/mappers.ts#L112-L140). The public create and update types allow status but no outcome, while dedicated completion accepts a plain string: [`src/sdk/types/task-operations.ts:27-37`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/src/sdk/types/task-operations.ts#L27-L37), [`src/sdk/types/task-operations.ts:55-57`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/src/sdk/types/task-operations.ts#L55-L57), and [`src/sdk/types/task-operations.ts:75-90`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/src/sdk/types/task-operations.ts#L75-L90).

CLI explicitly exposes status on both create and update, forwards them to the SDK, and validates only the dedicated command's outcome: [`src/cli/commands/task/crud.ts:64-140`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/src/cli/commands/task/crud.ts#L64-L140), [`src/cli/commands/task/crud.ts:143-170`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/src/cli/commands/task/crud.ts#L143-L170), and [`src/cli/commands/task/crud.ts:192-231`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/src/cli/commands/task/crud.ts#L192-L231).

MCP schemas allow completed on create/update; adapters delegate unchanged to the same services. Only the dedicated schema adds `z.string().min(1)`: [`src/mcp/task-schemas.ts:26-68`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/src/mcp/task-schemas.ts#L26-L68), [`src/mcp/task-tools.ts:23-59`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/src/mcp/task-tools.ts#L23-L59), and [`src/mcp/register-task-tools.ts:124-159`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/src/mcp/register-task-tools.ts#L124-L159).

## 5. Isolated reproduction

The temporary script was run from the exact worktree with:

```text
PATH=/home/chicks/.bun/bin:$PATH bun run .tmp/chi187-reproduction.ts
```

It initialized separate temporary SDK, CLI, and stdio MCP workspaces, then removed them. The essential results were:

| Case                                                                  | SDK                                                          | CLI                    | MCP                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------- | -------------------------------- |
| create completed feature with empty description/plan and open blocker | accepted; outcome null; completion time equals creation time | accepted; outcome null | accepted; outcome null           |
| readiness before generic update                                       | missing description/plan + open blocker                      | same                   | same, `valid: false`             |
| generic update to completed anyway                                    | accepted; outcome null                                       | exit 0, accepted       | `isError: false`, accepted       |
| dedicated complete while blocker remains open                         | `HAS_BLOCKERS`                                               | exit 1, `HAS_BLOCKERS` | `isError: true`, blocker message |
| dedicated complete with missing description/plan but no blocker       | accepted                                                     | accepted               | accepted                         |
| empty dedicated outcome                                               | accepted as `""`                                             | rejected by trim check | rejected by MCP minimum length   |
| whitespace-only dedicated outcome                                     | accepted by the same application boundary                    | rejected by trim check | accepted as `"   "`              |

The SDK timestamp sequence additionally observed:

```text
create(status=completed) -> completedAt == createdAt, outcome null
complete(outcome="")     -> completedAt set, empty outcome stored
complete(second outcome) -> outcome overwritten, completedAt reset
update(status=open)       -> completedAt cleared, second outcome retained
update(status=completed)  -> completedAt reset, retained outcome reused
```

No case required malformed transport input or direct database access. Every bypass used a documented public status field.

## 6. Complete coverage ledger

| Requested dimension                     | Conclusion                                                                                                                                                                                                                 | Evidence                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Service/repository create               | **Finding.** Initial completed status is persisted directly after blocker existence checks, not open-blocker/readiness checks; outcome is always null.                                                                     | TC-001; repository links in section 3        |
| Service/repository generic update       | **Finding.** Status and completion timestamp are written by `apply_core_updates`; no completion validation is invoked.                                                                                                     | TC-001, TC-004                               |
| Service/repository dedicated completion | **Partial enforcement.** Open blockers are rejected, but missing readiness fields and empty outcomes are accepted.                                                                                                         | TC-002, TC-003; reproduction                 |
| SDK parity                              | **Finding.** Thin mappings preserve all three service behaviors; TypeScript's `string` cannot enforce non-empty runtime content.                                                                                           | section 4 links and reproduction             |
| CLI parity                              | **Finding with one adapter guard.** Create/update retain the bypass. Dedicated completion alone trims outcome; readiness remains advisory.                                                                                 | section 4 links and reproduction             |
| MCP parity                              | **Finding with one weaker adapter guard.** Create/update retain the bypass. Dedicated completion rejects empty but accepts whitespace.                                                                                     | section 4 links and reproduction             |
| Initial creation with terminal status   | **Finding.** All transports accept completed creation with missing readiness fields and an unresolved blocker.                                                                                                             | TC-001                                       |
| Direct transition to terminal status    | **Finding.** All transports accept generic update after their own readiness operation reports invalid.                                                                                                                     | TC-001                                       |
| Blocker readiness                       | **Split contract.** Dedicated completion consistently returns `HAS_BLOCKERS`; create/update only validate blocker identity/existence.                                                                                      | TC-001; no-finding preservation in section 8 |
| Description/plan readiness              | **Finding.** Validation reports missing fields correctly, but no completion write consumes that result.                                                                                                                    | TC-002                                       |
| Outcome requirement                     | **Finding.** Generic paths cannot supply one; SDK/service accept empty; CLI rejects blank; MCP accepts whitespace.                                                                                                         | TC-003                                       |
| Completion timestamps                   | **Finding.** Creation, generic status update, reopening, recompletion, and dedicated repetition apply different timestamp/outcome semantics.                                                                               | TC-004                                       |
| Error behavior                          | **Finding.** Invalid readiness has no mutation error. Only dedicated blockers have typed `HAS_BLOCKERS`; adapter blank-outcome failures differ.                                                                            | TC-001–TC-003                                |
| Existing tests                          | **Gap.** Focused tests cover valid dedicated completion, dedicated blocker rejection, readiness reads, and deleted-task guards, but not terminal create/update bypasses, blank outcomes, or timestamp/outcome transitions. | TC-005                                       |
| Task guide                              | **Drift.** It prescribes validate then complete and forbids completion without outcome or with ignored blockers, while public create/update status remains available.                                                      | TC-005                                       |
| Adjacent lifecycle work                 | **No duplicate.** CHI-121 centralizes read-only inspection; CHI-160/165 protect deletion; CHI-166 repairs step cursor; CHI-182/183 repair graph behavior. None owns completion invariants.                                 | section 9                                    |

Every requested perspective has a finding or an explicit evidence-backed no-finding conclusion. The inquiry did not stop at a preset finding count.

## 7. Prioritized findings

### TC-001 — P2: generic create and update bypass the completion contract

**Direct answer.** Create and generic update are supported public paths to `completed`, and neither enforces readiness, open-blocker, or outcome requirements.

**Evidence.** Create computes a completion timestamp before checking only blocker identity/existence, then stores a null outcome. Generic update delegates terminal status to `apply_core_updates`, which changes only status/timestamp. SDK, CLI, and MCP all expose those status fields and delegate to the same writes. The three-transport reproduction accepted both bypasses after readiness reported missing description/plan and an open blocker.

**Impact.** Canonical SQLite can contain completed tasks that the documented validation operation declares unready, that still have unresolved blockers, and that have no outcome. Downstream summary/list/graph consumers then treat the terminal status as authoritative.

**Bounded recommendation.** Human triage should choose one explicit contract. The smallest coherent option is to reject `completed` in generic create/update and reserve terminal completion for the dedicated operation. If terminal creation is a legitimate import requirement, model it as an explicit completion-capable input/operation that carries and enforces the same readiness, blocker, outcome, and metadata rules. Do not add a second adapter-only workaround.

**Disposition:** `report-only`. No implementation or follow-up issue was created.

### TC-002 — P2: dedicated completion does not enforce its advertised readiness precondition

**Direct answer.** The dedicated path checks blockers but does not enforce completion readiness. `validateTransition` is a separate read that returns data and cannot protect a later mutation.

**Evidence.** `validate_task_transition_for_directory` calls `validate_status_transition` and returns missing fields. `complete_task` independently reads the task, checks blockers, and writes completed without using that result. SDK, CLI, and MCP each accepted dedicated completion of an unblocked feature whose validation reported missing description and plan.

**Impact.** Following the preferred command sequence is a caller convention, not a persisted invariant. Callers can skip validation, ignore `valid: false`, or encounter state changes between the read and write.

**Bounded recommendation.** Make the dedicated mutation own completion readiness and blocker checks at the authoritative service/repository boundary, with stable typed errors for missing fields and blockers. Keep the read-only validation endpoint as a preview of exactly the same rule, not the rule's only enforcement.

**Disposition:** `report-only`. No implementation or follow-up issue was created.

### TC-003 — P2: non-empty outcome validation is fragmented across transports

**Direct answer.** There is no application-owned non-empty outcome invariant.

**Evidence.** `CompleteTaskInput.outcome` is a plain string, and `complete_task` persists it without trimming or checking. SDK accepted an empty string. CLI performs its own trim check and rejects empty/whitespace. MCP's `min(1)` rejects empty but accepts a whitespace-only string. Generic create/update always omit outcome at the same transition.

**Impact.** Equivalent completion requests have route-dependent success and error shapes, while canonical rows can still contain null, empty, or whitespace-only outcomes.

**Bounded recommendation.** Define one application-level non-blank outcome rule and one typed expected error. Let CLI/MCP fail early for usability if desired, but require the shared write boundary to trim/check—or deliberately preserve exact text after checking its trimmed length—before persistence.

**Disposition:** `report-only`. No implementation or follow-up issue was created.

### TC-004 — P3: timestamp and retained-outcome semantics are path-dependent

**Direct answer.** Completion metadata does not express one transition contract.

**Evidence.** Initial terminal creation sets `completed_at = created_at` and null outcome. Every generic assignment to completed resets `completed_at`; every generic assignment away clears it; neither changes outcome. Dedicated completion overwrites outcome and resets the timestamp even when already completed. The isolated sequence therefore reopened a task with a retained prior outcome, then generically recompleted it using that stale outcome and a new timestamp.

**Impact.** `outcome` can describe an earlier completion while `completedAt` describes a later generic transition. Repeated completion is not idempotent, and consumers cannot infer which path produced the record.

**Bounded recommendation.** As part of the same human contract decision, define allowed transitions and idempotency: whether completed tasks can be reopened/recompleted, when outcome is cleared or required, and whether completion time records the first or latest valid completion. Enforce that decision in one mutation boundary; do not broaden into unrelated task-step lifecycle work.

**Disposition:** `report-only`. No implementation or follow-up issue was created.

### TC-005 — P3: tests and guidance encode a preferred workflow, not the invariant

**Direct answer.** Documentation says the right sequence, but schemas and regression coverage do not make it authoritative.

**Evidence.** The task guide says validate then complete, do not complete without an outcome, and do not ignore blockers: [`src/cli/commands/guide.ts:52-55`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/src/cli/commands/guide.ts#L52-L55) and [`src/cli/commands/guide.ts:92-99`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/src/cli/commands/guide.ts#L92-L99). SDK tests prove dedicated blocker rejection but resolve the blocker using the generic completion bypass: [`tests/sdk.test.ts:196-235`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/tests/sdk.test.ts#L196-L235). Inspection tests prove readiness reporting but do not attempt an invalid write: [`tests/task-inspection.service.test.ts:84-129`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/tests/task-inspection.service.test.ts#L84-L129). The MCP smoke test validates, repairs the plan, and completes only through the preferred path: [`tests/mcp-server.test.ts:228-273`](https://github.com/chrhicks/continuum/blob/306dcac04d2bab3ea0b52df2596265d83227a183/tests/mcp-server.test.ts#L228-L273).

**Impact.** All focused tests pass while the documented prohibited states remain reachable. Future refactors can preserve the same split because no negative regression defines the canonical invariant.

**Bounded recommendation.** After humans select the completion contract, add shared service/SDK tests for terminal create, generic terminal update, dedicated missing-readiness completion, blockers, blank outcome, repeated completion, reopen/recomplete, and timestamp/outcome behavior. Add CLI/MCP adapter cases only where their parsing/error representation differs.

**Disposition:** `report-only`. No implementation or follow-up issue was created.

## 8. Confirmed behavior to preserve and no-finding results

- Dedicated completion consistently rejects unresolved open/ready/blocked blockers with typed `HAS_BLOCKERS` at the application boundary and corresponding CLI/MCP errors.
- Generic create/update still validate blocker IDs for existence, duplicates, and self-reference. The defect is open-blocker readiness, not blocker referential integrity.
- CHI-160's deleted-task guard remains intact: normal update and completion reject deleted tasks, and focused regression tests passed.
- CHI-165's live-row write predicate, CHI-166's step cursor repair, and CHI-182/183's graph behavior are not implicated by the reproduced contract gap.
- The transition readiness operation is read-only and correctly reports the tested missing fields and blockers; the finding is that mutation paths do not consume it.
- Ordinary non-terminal field updates do not themselves alter `completed_at` unless a status field is included. No unrelated update-path defect was found.

## 9. Related issue and history disposition

- **CHI-121 is adjacent, not duplicate.** It introduced the named read-only task inspection/readiness boundary and preserved status semantics. TC-002 concerns authoritative write enforcement, not inspection readability.
- **CHI-160 and CHI-165 are adjacent, not duplicate.** They make deletion terminal and child writes liveness-safe. Their guards remain present.
- **CHI-166 is adjacent, not duplicate.** It owns task-step cursor reconciliation, not task completion.
- **CHI-182 and CHI-183 are adjacent, not duplicate.** They own parent-cycle and graph traversal behavior across terminal nodes.
- Continuum history records all six as staged adjacent work and records the originating CHI-187 reproduction at this same baseline. No prior item owns generic completion bypass, outcome validity, or completion metadata semantics.

## 10. Uncertainty, direct answers, and exclusions

- The report treats create/update `status` as supported because all public type/schema/help surfaces intentionally expose `completed`; it does not infer that callers are forbidden from using a documented enum value.
- Whether initial terminal creation is needed for imports or historical reconstruction is a product decision not documented in the inspected repository. The recommendation therefore presents an explicit alternative rather than silently deleting that capability.
- Whether reopening completed tasks should be supported is also undocumented. TC-004 reports the observed metadata inconsistency and leaves policy to human triage.
- The stale-read interval between readiness checks and writes was not stress-tested concurrently. TC-002 does not require a race to reproduce: sequential callers can already ignore readiness.
- Adjacent architectural observation: validation is centralized as a named read use case, but authoritative mutation rules remain distributed. This explains the defect; it is not a substitute for the direct completion-contract findings.
- No product code, tests, public API, task data, follow-up Linear issue, cloud resource, credential, deployment, migration, backup object, or destructive state was changed.

## 11. Validation record

```text
PATH=/home/chicks/.bun/bin:$PATH bun run .tmp/chi187-reproduction.ts
  passed; isolated SDK, CLI, and real stdio MCP matrices recorded above

PATH=/home/chicks/.bun/bin:$PATH bun test \
  tests/sdk.test.ts tests/mcp-server.test.ts tests/mcp-read-only.test.ts \
  tests/task-inspection.service.test.ts tests/task-cli-parse.test.ts \
  tests/task-child-write-deletion.test.ts tests/task-graph-terminal-nodes.test.ts \
  tests/task-parent-cycles.test.ts tests/task-step-cursor.test.ts
  passed: 34 tests, 0 failed, 235 assertions

bun run typecheck
  passed

bun test
  passed: 170 tests, 0 failed, 847 assertions

bun run validate
  passed on full rerun: typecheck, 170 tests, GOAL invariants, CLI smoke

ops/linear-agent/bin/validate-continuum-worktree <CHI-187 worktree>
  passed: isolated HOME/XDG/workspace, typecheck, 170 tests / 847 assertions,
  GOAL invariants, CLI smoke

bunx prettier --check reviews/xdg-storage-migration/CHI-187-task-completion-contract-audit.md
  passed

report consistency script
  23 commit-pinned source links and ranges valid
  required structure present
  5/5 findings carry report-only disposition

git diff --check
  passed
```

The first `bun run validate` reached the GOAL verifier's internal second test invocation and returned exit 1 without per-test failure detail after its preceding 170-test run had passed. An immediate standalone GOAL verification passed, followed by the successful full validation rerun and successful configured isolated validation recorded above.

The temporary reproduction and captured output are not part of the committed diff.
