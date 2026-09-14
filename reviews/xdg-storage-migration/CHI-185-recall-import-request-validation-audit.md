# CHI-185 canonical recall-import request-validation audit

## 1. Executive answer

**Primary question:** Do the public canonical recall-import application entry points validate `RecallImportRequest` consistently and fail explicitly, without changing valid import behavior?

**Answer: no.** The module-level application entry points accept a plain `RecallImportRequest` and do not validate its semantic constraints. `prepareCanonicalRecallImport` sends the request to extraction before returning the same unnormalized request, and `executeCanonicalRecallImport` later interprets it again. Invalid limits and an invalid `Date` can therefore complete successfully with a silently altered session set. They do not produce an expected request error.

The supported valid paths remain internally consistent in the inspected evidence: omitted filters inspect all extracted sessions; a valid `afterDate` is inclusive; a positive limit preserves newest-first order after date filtering; and current, dry-run import/refresh, import, and refresh outcomes retain their tested behavior. The audit found no valid-request regression to fix.

Three evidence-backed findings explain the negative verdict:

1. semantic request constraints are absent at both application entry points;
2. validation and error ownership are fragmented across the application, CLI, and MCP boundaries; and
3. extraction and execution both select sessions without one guaranteed validated request contract.

All three findings have the required **`report-only`** disposition. This inquiry made no product or test implementation change and created no follow-up issue.

## 2. Inspected source range and method

### Baseline

```text
repository: chrhicks/continuum
branch:     staging/xdg-storage-migration
commit:     539414eb664c8b8093ef38a96a7ef8a5b5d6cd66
worktree:   .linear-agent-worktrees/CHI-185
```

Every source link is commit-pinned to that exact staging commit.

### Method

The audit:

- traced `importCanonicalOpencodeRecall`, `prepareCanonicalRecallImport`, and `executeCanonicalRecallImport` through extraction, selection, outcome aggregation, and error mapping;
- inspected the request/prepared/result contracts, the real OpenCode SQLite extractor, CLI parsing, MCP schemas/adaptation, MCP Effect error conversion, package exports, all repository callers, and focused tests;
- compared the boundary with CHI-119, CHI-120, and CHI-181 for deduplication;
- ran an uncommitted, isolated dry-run matrix against an injected three-session extraction and a real temporary OpenCode SQLite database;
- directly exercised the CLI limit parser and MCP limit schema; and
- ran the existing recall application and extraction integration suites.

The reproduction used only temporary databases under the isolated worktree. It made no production/canonical data, cloud, credential, deployment, migration, backup, or destructive change.

## 3. Current request and execution flow

```text
CLI recall import
  -> parse date and positive-integer limit
  -> importCanonicalOpencodeRecall(raw typed request)

MCP recall import
  -> Zod positive-integer/max-1000 schema
  -> parse date
  -> importCanonicalOpencodeRecall(raw typed request)

importCanonicalOpencodeRecall
  -> prepareCanonicalRecallImport
     -> forward raw request to extractor
     -> extractor applies SQL date filtering and its own limit rule
     -> load summary configuration
     -> return PreparedRecallImport containing the same raw request
  -> executeCanonicalRecallImport
     -> apply date filter and Array.slice limit again
     -> classify current/dry-run or summarize and persist each session
     -> aggregate explicit per-session outcomes
```

Evidence:

- the request is a plain optional-field type with `limit?: number` and `afterDate?: Date`: [`src/memory/application/recall-import-contract.ts:14-21`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/memory/application/recall-import-contract.ts#L14-L21);
- preparation forwards the raw values before returning the same request: [`src/memory/application/recall-import.ts:50-74`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/memory/application/recall-import.ts#L50-L74) and [`src/memory/application/recall-import.ts:98-114`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/memory/application/recall-import.ts#L98-L114);
- execution filters and slices again: [`src/memory/application/recall-import.ts:77-95`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/memory/application/recall-import.ts#L77-L95) and [`src/memory/application/recall-import.ts:117-134`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/memory/application/recall-import.ts#L117-L134); and
- the real extractor applies its own date query and limit behavior: [`src/memory/opencode/extract.ts:67-101`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/memory/opencode/extract.ts#L67-L101), [`src/memory/opencode/extract.ts:115-123`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/memory/opencode/extract.ts#L115-L123), and [`src/memory/opencode/extract.ts:178-203`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/memory/opencode/extract.ts#L178-L203).

## 4. Reproduction ledger

The isolated source contained sessions `s3`, `s2`, and `s1`, ordered newest first at timestamps 3000, 2000, and 1000. Every application case used `dryRun: true`.

| Request case                         | Injected extraction   | Real SQLite extraction               | Explicit request failure?                                     |
| ------------------------------------ | --------------------- | ------------------------------------ | ------------------------------------------------------------- |
| omitted optional fields              | `s3,s2,s1`            | `s3,s2,s1`                           | no; valid                                                     |
| `limit: 1`                           | `s3`                  | covered by existing integration test | no; valid                                                     |
| `limit: 0`                           | empty                 | empty                                | **no**                                                        |
| `limit: -1`                          | `s3,s2`               | `s3,s2`                              | **no**                                                        |
| `limit: 1.5`                         | `s3`                  | `s3`                                 | **no**                                                        |
| `limit: NaN`                         | empty                 | empty                                | **no**                                                        |
| `limit: Infinity`                    | `s3,s2,s1`            | `s3,s2,s1`                           | **no**                                                        |
| `limit: -Infinity`                   | empty                 | empty                                | **no**                                                        |
| `afterDate: new Date(2000)`          | `s3,s2`               | `s3,s2`                              | no; valid and inclusive                                       |
| `afterDate: new Date('invalid')`     | empty                 | empty                                | **no**                                                        |
| `sessionId: 's2', limit: 0`          | not separately needed | empty                                | **no**; requested session silently removed                    |
| `sessionId: 's2', limit: -1`         | not separately needed | empty                                | **no**; requested session silently removed                    |
| `sessionId: 's2', invalid afterDate` | not separately needed | `RecallSourceError`                  | failure depends on the additional filter, not a request error |

`prepareCanonicalRecallImport` also succeeded for `{ limit: 0, afterDate: invalidDate }`, invoked extraction once before returning, and retained both invalid values in `PreparedRecallImport`.

The observed numbers follow JavaScript `Array.prototype.slice` coercion at the second selection stage. They are not an explicit application contract. The real extractor's first limit stage has a different rule: it applies a limit only when the number is finite and greater than zero, but it does not require an integer. The second stage then slices for every value whose runtime type is `number`.

A separate transport matrix produced:

| Value             | CLI `parseRecallLimit` | MCP schema           |
| ----------------- | ---------------------- | -------------------- |
| `0`, `-1`         | reject                 | reject               |
| `1.5`             | reject                 | reject               |
| `NaN`, `Infinity` | reject                 | reject               |
| `1`               | accept                 | accept               |
| `1001`            | accept                 | reject (`max(1000)`) |

CLI evidence: [`src/cli/commands/shared.ts:1-9`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/cli/commands/shared.ts#L1-L9), [`src/cli/commands/memory/option-parsers.ts:28-31`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/cli/commands/memory/option-parsers.ts#L28-L31), and [`src/cli/commands/memory/option-parsers.ts:120-122`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/cli/commands/memory/option-parsers.ts#L120-L122). MCP evidence: [`src/mcp/register-memory-tools.ts:44-60`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/mcp/register-memory-tools.ts#L44-L60).

## 5. Complete coverage ledger

| Requested dimension                          | Conclusion                                                                                                                                                                                                             | Evidence                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application schema and typed-error ownership | **Finding.** `RecallImportRequest` has no runtime schema or semantic constructor. Both entry points expose `Effect<..., unknown>`, and no request-validation error exists.                                             | RV-001, RV-002; request and entry-point links above                                                                                                                                                                                                                                                                                                                                      |
| CLI and MCP validation parity                | **Partial only.** Both reject the invalid limit/date examples before the application call. MCP alone caps limits at 1000, and their errors are transport-native rather than one application error.                     | RV-002; CLI/MCP links in section 4; [`src/mcp/memory-tools.ts:54-84`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/mcp/memory-tools.ts#L54-L84)                                                                                                                                                                                               |
| Zero and negative limits                     | **Finding.** Application calls succeed and silently return zero or all-but-last sessions. Combining either with one explicit session can silently remove that session.                                                 | reproduction ledger; RV-001, RV-003                                                                                                                                                                                                                                                                                                                                                      |
| Fractional limits                            | **Finding.** `1.5` succeeds and is truncated by `slice`; the extractor also accepts positive fractions.                                                                                                                | reproduction ledger; extractor/application selection links                                                                                                                                                                                                                                                                                                                               |
| Non-finite limits                            | **Finding.** `NaN`, positive infinity, and negative infinity all succeed with different selected sets.                                                                                                                 | reproduction ledger; RV-001                                                                                                                                                                                                                                                                                                                                                              |
| Positive limits                              | **No invalid-behavior finding.** Positive integer `1` preserves newest-first order. The unresolved contract question is whether 1000 is a universal or MCP-only maximum.                                               | reproduction/transport ledgers; RV-002                                                                                                                                                                                                                                                                                                                                                   |
| Valid dates                                  | **No production-path finding.** The boundary is inclusive (`created >= afterDate`) and the real integration test proves date filtering occurs before a positive limit.                                                 | [`src/memory/application/recall-import.ts:129-134`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/memory/application/recall-import.ts#L129-L134); [`tests/opencode-extract-integration.test.ts:18-72`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/tests/opencode-extract-integration.test.ts#L18-L72) |
| Invalid dates                                | **Finding.** An invalid `Date` has `NaN` time and usually becomes a successful empty import. With an explicit session it instead becomes a wrapped source lookup failure. Neither is an expected request error.        | reproduction ledger; RV-001                                                                                                                                                                                                                                                                                                                                                              |
| Omitted optional fields                      | **No finding.** Application, CLI, and MCP pass absence as `undefined`; application inspects all extracted sessions and defaults dry run to false.                                                                      | request flow; [`src/cli/commands/memory/recall-basic-handlers.ts:52-61`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/cli/commands/memory/recall-basic-handlers.ts#L52-L61)                                                                                                                                                                   |
| Current path                                 | **No finding.** A matching fingerprint returns `current`, skips summarization, and increments `skippedExisting`.                                                                                                       | [`tests/memory-recall-application.test.ts:158-189`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/tests/memory-recall-application.test.ts#L158-L189)                                                                                                                                                                                               |
| Dry-run import/refresh paths                 | **No finding for valid requests.** Dry run classifies without summary/write; valid changed content returns `would-refresh`, and the real extraction test returns `would-import`.                                       | [`tests/memory-recall-application.test.ts:226-255`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/tests/memory-recall-application.test.ts#L226-L255); [`tests/opencode-extract-integration.test.ts:49-72`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/tests/opencode-extract-integration.test.ts#L49-L72) |
| Import and refresh paths                     | **No finding for valid requests.** Initial imports and changed-session refreshes retain deterministic outcomes and atomic replacement coverage.                                                                        | [`tests/memory-recall-application.test.ts:191-224`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/tests/memory-recall-application.test.ts#L191-L224); [`tests/memory-recall-application.test.ts:226-276`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/tests/memory-recall-application.test.ts#L226-L276)   |
| Extraction/selection behavior                | **Finding.** Raw values reach extraction before validation, then date/limit selection is applied again with different limit semantics.                                                                                 | RV-001, RV-003; source links in section 3                                                                                                                                                                                                                                                                                                                                                |
| Direct application callers                   | **Finding with scope qualification.** CLI, MCP, and tests import the module directly. The package root exports only the task SDK, so these are module-level application APIs, not advertised package-root SDK methods. | repository-wide import search; [`package.json:10-15`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/package.json#L10-L15); RV-002                                                                                                                                                                                                                  |
| Error/result shape parity                    | **Finding.** Invalid application requests return successful normal results or incidental `RecallSourceError`; CLI/MCP reject with their own ordinary/protocol errors; application errors are typed only as `unknown`.  | RV-001, RV-002; [`src/mcp/result.ts:15-30`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/mcp/result.ts#L15-L30)                                                                                                                                                                                                                               |
| Validation before extraction and selection   | **Finding and recommendation.** Preparation calls extraction first, so no single validation gate protects source work or guarantees a normalized prepared request.                                                     | RV-001, RV-003                                                                                                                                                                                                                                                                                                                                                                           |
| Existing regression coverage                 | **Gap.** Seven focused tests cover valid current/dry-run/import/refresh/failure behavior, but no application, CLI, or MCP test covers the invalid request matrix.                                                      | test links above; focused run: 7 passed, 37 assertions                                                                                                                                                                                                                                                                                                                                   |

Every requested perspective and edge case has a finding or an explicit evidence-backed no-finding conclusion. The audit did not stop after a preset finding count.

## 6. Prioritized findings

### RV-001 — P2: semantic request values are not validated before source work

**Direct answer.** The application boundary does not consistently validate `RecallImportRequest` or fail explicitly. Both named entry points accept semantically invalid values that TypeScript's `number` and `Date` types cannot exclude.

**Evidence.**

- The request type has no constraints beyond `number` and `Date`: [`recall-import-contract.ts:14-21`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/memory/application/recall-import-contract.ts#L14-L21).
- `importCanonicalOpencodeRecall` delegates immediately to preparation, while preparation extracts before any validation or normalization: [`recall-import.ts:37-74`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/memory/application/recall-import.ts#L37-L74).
- The raw values are forwarded to the extractor: [`recall-import.ts:98-114`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/memory/application/recall-import.ts#L98-L114).
- The complete isolated matrix above returned successful normal result records for every invalid standalone case.

**Impact.** Direct module callers receive plausible empty, truncated, or uncapped results instead of an expected input failure. A caller requesting one explicit session can receive a successful zero-session result when an invalid limit removes the session after extraction. Invalid date behavior changes from successful-empty to incidental source failure when combined with `sessionId`, so callers cannot classify it as one request error.

**Bounded recommendation.** Define and decode one application-owned semantic request contract before extraction. Require a finite positive integer limit and a valid `Date` when present, unless human triage deliberately chooses and documents another contract. Return a dedicated tagged expected request error that identifies the invalid field/reason. Preserve all valid selection and current/dry-run/import/refresh behavior.

**Disposition:** `report-only`. No implementation or follow-up issue was created.

### RV-002 — P2: transport validation and expected error shape have no single owner

**Direct answer.** CLI and MCP protect their own inputs, but they do not establish a consistent application contract or error result for direct callers.

**Evidence.**

- CLI constructs the application request after local positive-integer and date parsing: [`recall-basic-handlers.ts:52-77`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/cli/commands/memory/recall-basic-handlers.ts#L52-L77).
- MCP constrains the number to a positive integer no greater than 1000, then separately parses the date: [`register-memory-tools.ts:44-60`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/mcp/register-memory-tools.ts#L44-L60) and [`memory-tools.ts:54-84`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/mcp/memory-tools.ts#L54-L84).
- The transport matrix proves CLI accepts 1001 while MCP rejects it.
- Both application entry points expose `Effect<..., unknown>` and define no request error; the existing contract does define a tagged execution error for partial session execution: [`recall-import.ts:37-54`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/memory/application/recall-import.ts#L37-L54) and [`recall-import-contract.ts:64-72`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/memory/application/recall-import-contract.ts#L64-L72).

**Impact.** A valid-looking TypeScript call has weaker guarantees than either transport. Error handling depends on the route used. The MCP-only maximum may be intentional ingress protection, but that intent is not represented in the application contract; a later adapter can omit all semantic validation again.

**Bounded recommendation.** Make semantic validity application-owned and let CLI/MCP parsing adapt into that same typed failure where practical. Human triage must explicitly decide whether 1000 is (a) an application-wide maximum enforced everywhere or (b) a documented MCP transport cap. Do not silently copy the cap into the application without that decision. Keep transport representation concerns—string parsing and MCP protocol schema errors—in their adapters.

**Disposition:** `report-only`. No implementation or follow-up issue was created.

### RV-003 — P3: prepared execution does not guarantee one validated selection contract

**Direct answer.** Validation belongs before extraction, but adding a check only to `prepareCanonicalRecallImport` would not by itself make the exported execution seam structurally safe or remove selection ambiguity.

**Evidence.**

- `PreparedRecallImport.request` is still typed as raw `RecallImportRequest`: [`recall-import-contract.ts:37-41`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/memory/application/recall-import-contract.ts#L37-L41).
- `executeCanonicalRecallImport` is exported and trusts that raw request while reapplying selection: [`recall-import.ts:77-95`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/src/memory/application/recall-import.ts#L77-L95).
- Extraction first applies finite-positive limit semantics and SQL date filtering, while execution later applies `slice` to every runtime number and retains an extracted session whose creation timestamp is absent: extractor/application links in section 3.
- The injected reproduction with a valid after-date retained an undated bundle; the real SQL path excluded rows without a qualifying creation timestamp. This is an override-contract discrepancy, not evidence of a current production valid-request regression.

**Impact.** A structurally constructed `PreparedRecallImport` can bypass preparation, and custom extraction dependencies must infer whether they should honor filters even though execution honors them again. The two stages happen to be idempotent for the tested valid real-extractor path, but invalid values expose their different rules.

**Bounded recommendation.** Make prepared execution carry a validated/normalized request type that cannot be constructed accidentally, or revalidate at the exported execution boundary. Define whether extraction returns all candidate sessions or already-selected sessions. If production extraction retains SQL filtering for efficiency, both stages must consume the same validated semantics and the override contract must state what execution will enforce. Do not broaden this inquiry into a generic extractor redesign.

**Disposition:** `report-only`. No implementation or follow-up issue was created.

## 7. Valid behavior to preserve

The findings do not justify changing supported outcome semantics:

- repeated import of an unchanged session returns `current` and skips a second summary;
- multiple sessions retain extraction order and one explicit outcome per session;
- valid dry run returns `would-import` or `would-refresh` without summary/write;
- changed content refreshes canonical current rows while retaining history;
- a failed session retains earlier completed outcomes and identifies later unattempted sessions; and
- valid real extraction applies inclusive `afterDate` filtering before a positive limit.

Evidence: [`tests/memory-recall-application.test.ts:158-364`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/tests/memory-recall-application.test.ts#L158-L364) and [`tests/opencode-extract-integration.test.ts:18-72`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/tests/opencode-extract-integration.test.ts#L18-L72).

Recommended implementation coverage, if humans later authorize work, should add direct application cases for zero, negative, fractional, `NaN`, both infinities, invalid `Date`, positive boundary values, omitted fields, and combinations with `sessionId`. Adapter tests should preserve CLI/MCP rejection and explicitly encode the decision about the MCP maximum.

## 8. Deduplication and adjacent observations

- **CHI-119 is adjacent, not a duplicate.** It separated raw request/dependency preparation from execution and added explicit per-session/partial-failure outcomes. Those are the seams audited here. Its staged implementation did not add semantic request validation or invalid-value tests. This report does not reopen its outcome behavior.
- **CHI-120 is not a duplicate.** It concerns memory evidence source/history query planning, not recall-import request validity.
- **CHI-181 is not a duplicate.** It removed unreachable artifact helpers while preserving this supported import path.
- The module exports recall entry points for internal use, but [`package.json:10-15`](https://github.com/chrhicks/continuum/blob/539414eb664c8b8093ef38a96a7ef8a5b5d6cd66/package.json#L10-L15) exposes only the task SDK at the package root. Calling these functions a supported external SDK would overstate the evidence. The direct-caller risk applies to repository modules, tests, and any unsupported deep import.
- The CLI's internal recall parser carries a default of 5, but the handler only invokes it when `--limit` is present, and the command help advertises no default. Omitted limit therefore consistently reaches the application as `undefined`; this is not reported as a behavioral finding.

## 9. Uncertainty and exclusions

- The audit did not run a downstream-consumer search outside this repository. The private package surface and local import graph are the basis for the API-scope conclusion.
- CLI and MCP both use JavaScript `Date` parsing. The repository does not state that recall import requires strict ISO syntax, so this report distinguishes valid versus invalid `Date` values without proposing a narrower string-format policy.
- The MCP limit of 1000 may be deliberate ingress protection. Only human triage should decide whether it belongs in the application contract.
- The undated-session discrepancy was reproduced through the supported extraction override seam, while the real SQL path filters by `time_created`. It is reported as contract ambiguity, not as a production data-loss claim.
- No product code, tests, public API, follow-up Linear issue, cloud resource, credential, deployment, migration, backup object, or canonical data was changed.

## 10. Validation record

```text
bun run .tmp/chi185-reproduction.ts
  passed; complete injected and real-SQL dry-run matrices recorded above

report consistency script
  36 commit-pinned source links and ranges valid
  required structure present
  3/3 findings carry report-only disposition

bunx prettier --check reviews/xdg-storage-migration/CHI-185-recall-import-request-validation-audit.md
  passed

bun test tests/memory-recall-application.test.ts tests/opencode-extract-integration.test.ts
  7 passed, 0 failed, 37 assertions

bun run typecheck
  passed

ops/linear-agent/bin/validate-continuum-worktree <CHI-185 worktree>
  passed: typecheck, 170 tests / 853 assertions, GOAL invariants, and isolated CLI smoke

git diff --check
  passed
```

The temporary reproduction was removed and is not part of the product diff.
