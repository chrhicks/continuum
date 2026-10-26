# CHI-207: Task API contract parity audit

## 1. Verdict

**Primary question:** Do Continuum's public task APIs present one consistent, reproducible contract across the SDK, CLI, and MCP for request options, response shape, pagination, and error classification, within the issue's stated exclusions?

**Answer: no.** The three surfaces share the same task repository and canonical `Task` mapper, so ordinary successful task data and the supported list traversal are substantially aligned. They do not, however, expose one complete or reproducible public contract:

1. MCP's generic task-update schema omits the SDK's public step/discovery/decision collection patches; the same patch succeeds through SDK and CLI but is stripped and fails through MCP.
2. Every surface advertises nullable step `summary` and `notes` patches, but all three silently preserve the old values when passed `null`.
3. Boundary validation and defaults differ for list limits, required create fields, whitespace, empty step arrays, unknown step fields, and note source attribution.
4. Get/expansion and missing-task semantics differ: SDK returns `null`, CLI returns `UNKNOWN_ERROR`, MCP returns an unclassified tool error, and relation omission differs.
5. Typed repository errors survive SDK and JSON CLI boundaries but lose their code and suggestions at the MCP boundary.
6. Current tests and documentation exercise individual happy paths and selected regressions, not the cross-surface contract that would detect these differences.

All six findings have the required **`report-only`** disposition. This inquiry changed no product source, tests, documentation, prompts, configuration, or cloud resources and created no follow-up issue.

## 2. Baseline, scope, and method

```text
repository:  https://github.com/chrhicks/continuum
branch:      staging/xdg-storage-migration
commit:      7c58bd352623b50fdcaf61f527620391fd9799fb
issue:       CHI-207
policy:      report-only
worktree:    .linear-agent-worktrees/CHI-207
Bun:         1.4.2
```

The audit inspected the complete named SDK, CLI, and MCP files plus the supporting task service/repository, mappers, public types, error handling, and focused tests. In particular it covered:

- `src/sdk/index.ts`, `src/sdk/types.ts`, `src/sdk.d.ts`, `src/sdk/mappers.ts`, and all public task type modules;
- `src/cli.ts`, task command registration, CRUD, parsing, rendering, steps, notes, input handling, and `src/cli/task-steps.ts`;
- `src/mcp/task-schemas.ts`, `src/mcp/task-tools.ts`, `src/mcp/task-read-tools.ts`, `src/mcp/register-task-tools.ts`, `src/mcp/result.ts`, and workspace resolution;
- the task repository/service, list pagination, inspection, validation, step, and note boundaries; and
- `tests/sdk.test.ts`, `tests/sdk-contract.ts`, `tests/mcp-server.test.ts`, `tests/mcp-read-only.test.ts`, and all focused task tests.

A disposable black-box matrix used fresh SDK, JSON CLI, and real stdio MCP workspaces. It ran from the exact commit above, used isolated `HOME` and `XDG_DATA_HOME`, and removed all workspaces afterward. The uncommitted reproduction and output lived under ignored `chi207.tmp/` and are not part of the artifact.

The audit did **not** reopen the already investigated semantics for deleted-task mutation, cyclic parents, terminal graph traversal, completion invariants, current-step alignment, cursor-pagination correctness, or CLI `--expand` validation. Those areas were run as regression evidence only where needed to establish a boundary.

## 3. Public API-surface matrix

| Operation                 | SDK                                                          | JSON CLI                                                                                | MCP                                                                                       | Parity conclusion                                                                                |
| ------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Create                    | `task.create(input)`; public type requires `description`     | `task create`; scalar flags or `--input`; omitted description becomes `""`              | `continuum_task_create`; nested `task`; schema requires description                       | Same core write, but required/default and whitespace rules differ (API-003).                     |
| Get                       | `task.get(id) -> Task \| null`; no expansion options         | `task get`; `--expand`, `--tree`, `--include-deleted`; JSON returns task plus relations | `continuum_task_get`; `expand[]`, `includeDeleted`; returns workspace plus task/relations | Capability, absence, and relation-omission semantics differ (API-004).                           |
| List                      | `task.list(options)`                                         | Equivalent flags; JSON returns the SDK list result in an envelope                       | Nested `options`; workspace plus list result                                              | Filters/default ordering and cursors share one repository; limit validation differs (API-003).   |
| Update core fields        | `task.update(id, patch)`                                     | Scalar flags or `--patch`; delegates to SDK                                             | `continuum_task_update`                                                                   | Equivalent for valid core fields, subject to boundary-validation/error differences.              |
| Update collections        | Step/discovery/decision add/update/delete collection patches | `--patch` accepts the same collection patches                                           | Generic schema omits all three collections; dedicated tools cover only a subset           | Confirmed capability gap (API-001).                                                              |
| Complete                  | `task.complete`                                              | `task complete`                                                                         | `continuum_task_complete`                                                                 | Present on all three; lifecycle semantics are excluded by CHI-207 and covered by staged CHI-187. |
| Delete                    | `Promise<void>`                                              | `{ deleted: true }` in CLI envelope                                                     | `{ workspace, deleted: true, id }`                                                        | Same soft-delete operation; transport acknowledgements intentionally differ.                     |
| Restore                   | Not exposed                                                  | Not exposed                                                                             | Not exposed                                                                               | Explicit no-finding: no public task-restore contract is claimed.                                 |
| Validate transition       | Missing fields and blockers                                  | Adds task/status context in CLI envelope                                                | Adds workspace/id/transition and derived `valid`                                          | Same inspection rule; convenience fields differ and are derivable.                               |
| Graph                     | `graph(query, taskId)`                                       | positional query then task ID                                                           | named query and ID                                                                        | Same task-ID result semantics; focused adapter test passed.                                      |
| Steps add/update/complete | Present; add accepts an empty array                          | Present; add requires non-empty strict input                                            | Present; add requires non-empty non-strict input                                          | Shared mutations, fragmented input/null rules (API-002/API-003).                                 |
| Steps list                | No dedicated method; available on `Task.steps` from get      | Dedicated command                                                                       | Dedicated tool                                                                            | Presentation/capability difference documented under API-004.                                     |
| Notes add                 | Present; `source` required by public type                    | Present; source defaults to `agent`                                                     | Present; source defaults to `agent`                                                       | Default contract differs; untyped SDK omission stores `system` (API-003).                        |
| Notes flush               | Not exposed                                                  | CLI-only orchestration into memory                                                      | Not exposed                                                                               | Intentional command workflow, not an equivalent task CRUD operation.                             |

The SDK and MCP both map stored rows through the same `map_task`, and CLI task mutations delegate to the SDK. The stable task payload therefore normalizes IDs to strings, absent task text to documented null/empty values, and nested steps/notes consistently: [`src/sdk/mappers.ts:27-101`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/sdk/mappers.ts#L27-L101). The findings concern operations, accepted inputs, optional/null meaning, relation envelopes, and errors—not a second task serializer.

## 4. Executed contract matrix

The black-box probe produced these representative results:

| Case                                                      | SDK                                                                  | CLI                                    | MCP                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------ |
| `list(limit: 0)`                                          | accepted; repository defaulted it                                    | rejected, `UNKNOWN_ERROR`              | rejected as JSON-RPC `-32602`                                |
| `list(limit: 1001)`                                       | accepted                                                             | accepted                               | rejected; maximum 1000                                       |
| create title `"   "`                                      | accepted verbatim                                                    | rejected as missing title              | accepted verbatim                                            |
| omit create description                                   | rejected by TypeScript declaration; untyped runtime accepted as `""` | accepted as `""`                       | rejected as required input                                   |
| add `steps: []`                                           | accepted no-op                                                       | rejected                               | rejected                                                     |
| step containing unknown `extra` field                     | accepted and ignored                                                 | rejected by strict schema              | accepted and stripped                                        |
| update step `{ summary: null, notes: null }`              | old values retained                                                  | old values retained                    | old values retained                                          |
| generic update with step + discovery collection additions | accepted; both added                                                 | accepted; both added                   | fields stripped, then tool failed with `No fields to update` |
| omitted note source                                       | public type requires source; untyped runtime stored `system`         | stored `agent`                         | stored `agent`                                               |
| get missing task                                          | returned `null`                                                      | `UNKNOWN_ERROR`, task-specific message | `isError: true`, text `Task not found`, no code              |
| create with missing parent                                | `PARENT_NOT_FOUND` plus suggestion                                   | same code/message/suggestion           | text `Parent task not found`, no code/suggestion             |
| list in uninitialized workspace                           | `NOT_INITIALIZED` plus suggestion                                    | same code/message/suggestion           | read-only text diagnostic, no stable code                    |
| get without expansion                                     | bare `Task`                                                          | `{ task, parent: null }`               | `{ workspace, task }`; relation omitted                      |

These were valid transport calls except where the row explicitly tests invalid input. No direct database writes were used.

## 5. Complete coverage ledger

| Requested dimension           | Evidence-backed conclusion                                                                                                                                                       | Finding/disposition                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Create request options        | Core camelCase fields map to one repository. Description requirement, whitespace title handling, and runtime/static validation differ.                                           | API-003, `report-only`                                                   |
| Get                           | SDK is nullable and unexpanded; CLI/MCP expose expansion and error on absence; unrequested relation serialization differs.                                                       | API-004, `report-only`                                                   |
| List filters                  | Status, type, parent, deleted inclusion, cursor, sort, and order reach the same list repository.                                                                                 | No finding except limit boundary below.                                  |
| List defaults                 | Repository defaults to priority ascending, limit 50, and excludes completed/cancelled/deleted unless selected.                                                                   | Confirmed shared behavior.                                               |
| List limit                    | SDK silently defaults non-positive values, CLI rejects non-positive values, and only MCP caps at 1000.                                                                           | API-003, `report-only`                                                   |
| Pagination                    | All adapters pass the same opaque cursor into the same repository and expose `nextCursor`; traversal regression tests passed. Cursor correctness itself is excluded staged work. | No new finding.                                                          |
| Update core fields            | Equivalent valid fields reach `map_update_input` and one repository. Null clears are preserved for core nullable task fields.                                                    | No finding.                                                              |
| Update collections            | SDK public type and CLI JSON patch support collection add/update/delete; MCP's generic patch omits them and dedicated tools do not replace the full capability.                  | API-001, `report-only`                                                   |
| Delete                        | All three call the same soft-delete service. Success acknowledgement shapes differ by transport.                                                                                 | No finding; deleted-mutation semantics excluded.                         |
| Restore                       | No task restore operation exists on any audited public surface.                                                                                                                  | Explicit no-finding; no claimed contract.                                |
| Completion/validation         | Operations exist across all three and share services. MCP adds a derived `valid`; CLI adds context. Completion invariants are covered by CHI-187 and not re-audited.             | No new finding.                                                          |
| Graph/expanded relationships  | Graph IDs share one query implementation. Get expansion exists only in CLI/MCP and has different aliases/serialization; SDK has no equivalent expanded get.                      | API-004, `report-only`                                                   |
| Step add                      | Mutation is shared, but empty-array, whitespace, and unknown-field acceptance differ.                                                                                            | API-003, `report-only`                                                   |
| Step update                   | Valid scalar changes share the repository. Nullable `summary`/`notes` values are accepted but cannot clear persisted values.                                                     | API-002, `report-only`                                                   |
| Step complete/list            | Completion delegates to one service. CLI/MCP provide a dedicated list; SDK exposes steps only through task results.                                                              | Surface difference recorded under API-004; no separate mutation finding. |
| Notes                         | Dedicated add is shared. Source omission differs; generic collection note update/delete is absent from MCP.                                                                      | API-001/API-003, `report-only`                                           |
| Null versus omission          | Core task nulls are distinct from omission; step summary/notes collapse null into omission at adapters/repository. Unrequested get relations are null in CLI and omitted in MCP. | API-002/API-004, `report-only`                                           |
| Success serialization         | Canonical `Task` payload is shared. CLI envelopes data/meta; MCP adds workspace and structured content; SDK returns values directly.                                             | Expected transport wrappers; no finding by themselves.                   |
| Invalid enum/identifier input | CLI parser errors are generally `UNKNOWN_ERROR`; MCP rejects at schema/adaptor boundaries; SDK relies on TypeScript plus uneven runtime checks.                                  | API-003/API-005, `report-only`                                           |
| Missing repository entities   | Typed service errors exist, but get absence and MCP transport handling do not preserve one classification.                                                                       | API-004/API-005, `report-only`                                           |
| Storage/database failure      | Uninitialized and migration-pending reads fail closed; MCP read-only tests confirm no storage mutation. SDK/CLI preserve typed initialization data while MCP exposes text only.  | API-005 for classification; storage safety confirmed.                    |
| Focused tests                 | SDK and MCP happy flows, read-only storage, pagination, graph, deleted writes, cycles, and step cursor are covered. Cross-surface options/null/errors are not.                   | API-006, `report-only`                                                   |
| Documentation                 | README lists operation families and the CLI guide gives workflow commands, but no public matrix defines parity or intentional differences.                                       | API-006, `report-only`                                                   |

Every requested dimension has either a finding or an explicit evidence-backed no-finding conclusion. The inquiry did not stop at a preset finding count.

## 6. Prioritized findings

### API-001 — P1 — MCP generic update silently omits public collection-patch capabilities

**Direct answer.** Equivalent generic task patches are not supported across the three surfaces.

The public SDK `UpdateTaskInput` includes `steps`, `discoveries`, and `decisions` collection patches with add/update/delete operations: [`src/sdk/types/task-operations.ts:75-93`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/sdk/types/task-operations.ts#L75-L93). `map_update_input` converts all three, and the repository applies them: [`src/sdk/mappers.ts:124-171`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/sdk/mappers.ts#L124-L171). CLI `--patch` deserializes the same update type and forwards it unchanged: [`src/cli/commands/task/crud.ts:241-281`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/cli/commands/task/crud.ts#L241-L281).

By contrast, `taskPatchSchema()` is declared as `ZodType<UpdateTaskInput>` but lists only core fields; all three collection properties are absent: [`src/mcp/task-schemas.ts:57-69`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/mcp/task-schemas.ts#L57-L69). Zod's default object behavior strips those unknown properties before `updateMcpTask` runs. In the reproduction, the same step-plus-discovery patch added both items through SDK and CLI; MCP stripped both and failed with `No fields to update`.

Dedicated MCP tools do not supply equivalent coverage. MCP offers step add/update/complete and note add, but no step delete and no discovery/decision update or delete: [`src/mcp/register-task-tools.ts:176-243`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/mcp/register-task-tools.ts#L176-L243). This is therefore not merely a preference for named operations.

**Impact.** MCP clients cannot reproduce supported SDK/CLI state changes and receive a misleading no-change failure rather than an unsupported-field diagnosis. The schema's `ZodType<UpdateTaskInput>` annotation also overstates its runtime coverage.

**Bounded recommendation.** Human triage should choose and document one public capability set: either expose the complete collection patch in MCP, add dedicated MCP delete/update tools that cover the same operations, or intentionally narrow the shared public update type and CLI patch contract. Unknown unsupported fields should be rejected explicitly rather than stripped into a different failure.

**Disposition:** `report-only`. No implementation or follow-up issue was created.

### API-002 — P2 — Nullable step patches cannot clear `summary` or `notes`

**Direct answer.** The public null/omission contract is reproducibly wrong on all three surfaces.

`TaskStep.summary` and `TaskStep.notes` are publicly nullable, and `Partial<TaskStep>` is the SDK step-update input: [`src/sdk/types/task-models.ts:26-34`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/sdk/types/task-models.ts#L26-L34) and [`src/sdk/types/continuum-sdk.ts:32-41`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/sdk/types/continuum-sdk.ts#L32-L41). The MCP patch schema likewise explicitly accepts string or null: [`src/mcp/task-schemas.ts:82-91`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/mcp/task-schemas.ts#L82-L91). CLI JSON patches preserve the parsed null into the SDK call: [`src/cli/commands/task/steps.ts:195-214`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/cli/commands/task/steps.ts#L195-L214).

Both SDK and MCP adapters then use `?? undefined`, collapsing explicit null into omission: [`src/sdk/index.ts:160-180`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/sdk/index.ts#L160-L180) and [`src/mcp/task-tools.ts:84-108`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/mcp/task-tools.ts#L84-L108). The generic SDK collection mapper does the same: [`src/sdk/mappers.ts:139-154`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/sdk/mappers.ts#L139-L154). The repository also uses nullish fallback for summary: [`src/task/steps.repository.ts:87-117`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/task/steps.repository.ts#L87-L117).

The reproduction seeded both fields, sent `{ summary: null, notes: null }` through SDK, CLI, and MCP, and observed both seeded values unchanged in every returned task.

**Impact.** A formally accepted patch reports success without performing the requested clear. Callers cannot distinguish intentional no-change from silently collapsed null and cannot clear these fields through the dedicated public operation.

**Bounded recommendation.** Define null as clear and undefined as omit, then preserve that distinction through public types, schemas, adapters, service input, and repository update logic. If null is intentionally not a clear operation, remove it from update inputs while retaining it only in result models.

**Disposition:** `report-only`. No implementation or follow-up issue was created.

### API-003 — P2 — Input validation and defaults are transport-dependent

**Direct answer.** Equivalent request boundaries accept, reject, or default the same values differently.

Confirmed examples include:

- SDK list forwards an unchecked numeric limit; the repository treats a non-positive value as the default 50. CLI requires a positive integer but has no maximum. MCP requires a positive integer no greater than 1000: [`src/sdk/index.ts:65-81`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/sdk/index.ts#L65-L81), [`src/cli/commands/task/parse.ts:25-42`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/cli/commands/task/parse.ts#L25-L42), [`src/cli/commands/task/parse.ts:125-127`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/cli/commands/task/parse.ts#L125-L127), and [`src/mcp/register-task-tools.ts:59-75`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/mcp/register-task-tools.ts#L59-L75).
- CLI trims to test required title/type; SDK forwards title; MCP's `min(1)` counts whitespace. A whitespace-only title was accepted by SDK/MCP and rejected by CLI: [`src/cli/commands/task/crud.ts:192-238`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/cli/commands/task/crud.ts#L192-L238) and [`src/mcp/task-schemas.ts:43-55`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/mcp/task-schemas.ts#L43-L55).
- SDK's declaration and MCP schema require create description, while CLI defaults omission to `""`; the untyped SDK runtime also accepts omission: [`src/sdk/types/task-operations.ts:27-37`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/sdk/types/task-operations.ts#L27-L37), [`src/cli/commands/task/crud.ts:202-229`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/cli/commands/task/crud.ts#L202-L229), and [`src/mcp/task-schemas.ts:43-55`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/mcp/task-schemas.ts#L43-L55).
- SDK accepts an empty step array as a no-op; CLI and MCP require at least one step. CLI's step schema is strict and trims strings; MCP's object schema strips unknown fields and uses non-trimming `min(1)`: [`src/cli/task-steps.ts:11-31`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/cli/task-steps.ts#L11-L31), [`src/sdk/index.ts:142-160`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/sdk/index.ts#L142-L160), and [`src/mcp/register-task-tools.ts:183-192`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/mcp/register-task-tools.ts#L183-L192).
- `TaskNoteInput.source` is required by the SDK declaration. CLI and MCP make it optional and default to `agent`; an untyped SDK omission reaches the repository default `system`: [`src/sdk/types/task-operations.ts:48-54`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/sdk/types/task-operations.ts#L48-L54), [`src/cli/commands/task/parse.ts:187-198`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/cli/commands/task/parse.ts#L187-L198), [`src/mcp/task-tools.ts:128-151`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/mcp/task-tools.ts#L128-L151), and [`src/task/notes.repository.ts:11-56`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/task/notes.repository.ts#L11-L56).

**Impact.** A caller switching transports cannot predict whether the same logical value is rejected, ignored, defaulted, or attributed differently. The differences are not documented as transport policy and do not originate from one authoritative runtime schema.

**Bounded recommendation.** Define shared application-boundary validation/default rules for task operations, then make TypeScript types, CLI parsing, and MCP schemas project that contract. Transport-specific syntax may differ, but equivalent decoded requests should have equivalent acceptance and defaults.

**Disposition:** `report-only`. No implementation or follow-up issue was created.

### API-004 — P2 — Get, expansion, and absence do not have one result contract

**Direct answer.** The read surface differs beyond expected transport envelopes.

SDK `task.get` accepts only an ID and returns `Task | null`: [`src/sdk/index.ts:85-88`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/sdk/index.ts#L85-L88). CLI get adds `--tree`, comma-separated expansion with a CLI-only `all` alias, and deleted-child inclusion. MCP adds explicit expansion and deleted-child inclusion, but not the CLI aliases: [`src/cli/commands/task.ts:103-145`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/cli/commands/task.ts#L103-L145) and [`src/mcp/register-task-tools.ts:81-94`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/mcp/register-task-tools.ts#L81-L94).

For a missing task, SDK returned null, CLI replaced absence with a plain error that serialized as `UNKNOWN_ERROR`, and MCP threw typed `TASK_NOT_FOUND` internally but exposed only text. For a successful request with no expansion, CLI unconditionally emitted `parent: null`, while MCP omitted unrequested relation keys: [`src/cli/commands/task.ts:128-145`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/cli/commands/task.ts#L128-L145) and [`src/mcp/task-read-tools.ts:43-81`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/mcp/task-read-tools.ts#L43-L81). CLI therefore cannot distinguish “parent not requested” from “requested and absent” in JSON, while MCP can through omission versus null.

SDK likewise has no dedicated step-list operation, while CLI and MCP expose one. The data remains available through `Task.steps`, but the callable surface is not equivalent.

**Impact.** Consumers need transport-specific control flow and cannot rely on a shared absence or expansion shape. Generated clients cannot infer whether null means no entity, no relationship, or unrequested relationship without adapter-specific knowledge.

**Bounded recommendation.** Document and type a shared read model: decide whether missing get is nullable or a typed error; distinguish unrequested relationships from requested-empty relationships; and either expose equivalent SDK expansion/step-list operations or explicitly classify CLI/MCP expansion as transport-only convenience.

**Disposition:** `report-only`. No implementation or follow-up issue was created.

### API-005 — P2 — MCP failures discard stable task error classification

**Direct answer.** Stable repository error codes and suggestions are not preserved across all public transports.

`ContinuumError` defines task-domain codes and optional suggestions: [`src/task/error.ts:1-36`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/task/error.ts#L1-L36). SDK callers receive that object. CLI `formatError` explicitly serializes its code, message, and suggestions into the JSON error envelope: [`src/cli/io.ts:188-219`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/cli/io.ts#L188-L219).

MCP wraps only successful values with `toolResult`; task handlers throw failures through the MCP server without a domain-error result mapper: [`src/mcp/result.ts:1-14`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/mcp/result.ts#L1-L14) and [`src/mcp/register-task-tools.ts:122-243`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/mcp/register-task-tools.ts#L122-L243). A missing parent therefore produced the same `PARENT_NOT_FOUND` code and suggestion in SDK/CLI but only `Parent task not found` in MCP. Uninitialized reads similarly lost the SDK/CLI classification, while schema failures used JSON-RPC `-32602` with raw Zod details.

CLI adapter validation also frequently throws plain `Error`, which `formatError` classifies as `UNKNOWN_ERROR`; the limit and missing-get probes demonstrated this. Thus neither invalid-input classification nor repository-failure classification is stable across all three transports.

**Impact.** MCP agents must parse human text to distinguish retryable input problems, missing entities, initialization, blockers, and unexpected failures. Suggestions available to SDK/CLI automation disappear exactly at the agent-facing boundary.

**Bounded recommendation.** Define a transport-neutral public error payload and map typed domain/storage failures into it for MCP as structured content (or a documented protocol error data field). Assign stable codes to expected CLI adapter validation failures rather than collapsing them into `UNKNOWN_ERROR`. Preserve transport-native JSON-RPC codes only as an outer classification.

**Disposition:** `report-only`. No implementation or follow-up issue was created.

### API-006 — P2 — Tests and documentation do not define cross-surface parity

**Direct answer.** Existing validation can pass while the preceding five contract gaps remain.

SDK tests cover smoke CRUD, lifecycle patches, blockers, deleted-task guards, and step warnings: [`tests/sdk.test.ts:45-326`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/tests/sdk.test.ts#L45-L326). The compile-time SDK contract is eight lines and asserts only assignment plus one list call: [`tests/sdk-contract.ts:1-8`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/tests/sdk-contract.ts#L1-L8). MCP has one broad happy-path server test plus strong read-only storage tests: [`tests/mcp-server.test.ts:31-324`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/tests/mcp-server.test.ts#L31-L324) and [`tests/mcp-read-only.test.ts:80-228`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/tests/mcp-read-only.test.ts#L80-L228). CLI-focused task coverage tests expansion parsing and graph serialization, not CRUD/step/note parity: [`tests/task-cli-parse.test.ts:21-94`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/tests/task-cli-parse.test.ts#L21-L94) and [`tests/task-graph-terminal-nodes.test.ts:106-147`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/tests/task-graph-terminal-nodes.test.ts#L106-L147).

README enumerates command families, and the task guide shows preferred CLI commands, but neither defines required fields, null behavior, defaults, error codes, or intentional surface differences: [`README.md:65-88`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/README.md#L65-L88) and [`src/cli/commands/guide.ts:72-99`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/cli/commands/guide.ts#L72-L99).

**Impact.** Each adapter can remain locally tested while drifting from the others. Consumers have no normative source to decide whether a difference is intentional, unsupported, or defective.

**Bounded recommendation.** After human disposition, add a table-driven cross-surface contract suite for equivalent decoded requests and results: operation availability, defaults, null/omission, limit boundaries, strictness, missing entities, and typed failures. Document the small set of intentional transport wrappers and syntax differences separately.

**Disposition:** `report-only`. No implementation or follow-up issue was created.

## 7. Confirmed parity and no-finding results

- **Canonical task payloads are shared.** SDK, CLI mutation results, and MCP tools use `map_task`; no field-name, ID-type, or nested-task serialization fork was found for successful ordinary requests.
- **List query semantics are shared after decoding.** Status/type/parent/deleted filters, sort/order, cursor decode, default limit/order, and `nextCursor` are owned by one repository: [`src/task/tasks.repository.list.ts:57-112`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/task/tasks.repository.list.ts#L57-L112) and [`src/task/tasks.repository.list.ts:168-209`](https://github.com/chrhicks/continuum/blob/7c58bd352623b50fdcaf61f527620391fd9799fb/src/task/tasks.repository.list.ts#L168-L209). The focused six-ordering pagination traversal passed on retry-independent execution.
- **Core update nulls are not implicated.** Intent, plan, priority, parent, and blocker null/omission mapping preserves the intended distinction. API-002 is specific to step summary/notes.
- **Valid step and note writes share one repository.** The findings concern accepted boundaries, missing collection capabilities, and nullable clears, not separate persistence implementations.
- **Graph result semantics are aligned.** SDK, CLI, and MCP call the same graph query. The focused adapter test passed. Terminal traversal and cycle behavior remain excluded staged work.
- **Delete is consistently a soft delete.** There is no task restore API on any surface. Reserved/deleted mutation behavior is intentionally not re-reported here.
- **Read-only MCP tools preserve storage.** The full read-only storage suite passed current, migration-pending, uninitialized, legacy, and missing-database cases without file mutation.
- **Transport envelopes are expected.** CLI's `{ ok, data/error, meta }`, MCP's workspace/structured-content wrapper, and SDK's direct return values are not findings by themselves. Findings apply where semantics or programmatic classification differ inside those wrappers.
- **Completion behavior is not duplicated.** CHI-187 already reports completion-contract gaps. This report only records operation presence and adapter shape needed for the parity question.

## 8. Direct answers, adjacent observations, and uncertainty

### Direct answers

- Equivalent successful task payloads are mostly consistent because they share one mapper.
- Equivalent operation capability is not consistent because MCP cannot express all generic update patches.
- Equivalent accepted-input behavior is not consistent because validation/defaults are independently implemented.
- Null/omission behavior is not truthful for nullable step patches.
- Expanded read and missing-entity behavior is not consistent.
- Error classification is not stable at the MCP boundary.

### Adjacent architectural observation

The repository/service layer is a useful single persistence owner, but public contract ownership is split among TypeScript declarations, Commander parsing, Zod schemas, and ad hoc error adapters. That architecture explains the parity gaps; it is not a substitute for the direct findings above and is not a general architecture review.

### Uncertainty and limitations

- The repository does not document whether omitted create description, empty step additions, extra fields, or a 1000-item maximum are intentional transport policy. Because equivalent requests demonstrably differ, the report records the mismatch and leaves policy selection to humans.
- The black-box SDK runtime probes that omit statically required properties intentionally test JavaScript/runtime behavior; the report separately identifies what the TypeScript declaration accepts.
- Combined focused-test attempts exposed the pre-existing order-sensitive `task-parent-cycles` assertion. An isolated rerun and the final complete focused rerun passed without source changes. This does not support a new CHI-207 finding and was not investigated beyond recording validation evidence.
- No concurrency, performance, cloud, backup, memory, XDG migration, or LLM behavior was audited.

## 9. Complete disposition ledger

```yaml
policy: report-only
findings:
  - id: API-001
    priority: P1
    disposition: report-only
    class: mcp-task-update-capability-gap
  - id: API-002
    priority: P2
    disposition: report-only
    class: nullable-step-patch-no-op
  - id: API-003
    priority: P2
    disposition: report-only
    class: cross-transport-validation-default-drift
  - id: API-004
    priority: P2
    disposition: report-only
    class: get-expansion-absence-contract-drift
  - id: API-005
    priority: P2
    disposition: report-only
    class: mcp-error-classification-loss
  - id: API-006
    priority: P2
    disposition: report-only
    class: parity-test-documentation-gap
follow_up_issues_created: 0
product_mutations: 0
```

## 10. Validation record

The following evidence was collected from the exact baseline:

```text
PATH=/home/chicks/.bun/bin:$PATH bun run chi207.tmp/repro.ts
  passed; disposable SDK, JSON CLI, and real stdio MCP matrix produced the results in section 4

PATH=/home/chicks/.bun/bin:$PATH bun test \
  tests/sdk.test.ts tests/mcp-server.test.ts tests/mcp-read-only.test.ts \
  tests/task-cli-parse.test.ts tests/task-inspection.service.test.ts \
  tests/task-list-pagination.test.ts tests/task-child-write-deletion.test.ts \
  tests/task-graph-terminal-nodes.test.ts tests/task-parent-cycles.test.ts \
  tests/task-step-cursor.test.ts
  final rerun passed: 37 tests, 0 failed, 270 assertions
  earlier attempts exposed the recorded order-sensitive parent-cycle assertion

PATH=/home/chicks/.bun/bin:$PATH bun test tests/task-parent-cycles.test.ts
  passed: 3 tests, 0 failed, 16 assertions

PATH=/home/chicks/.bun/bin:$PATH bun run validate
  passed on full rerun: typecheck, 173 tests / 880 assertions,
  GOAL invariants, and CLI smoke

PATH=/home/chicks/.bun/bin:$PATH \
  /home/chicks/workspaces/agents/continuum-control/ops/linear-agent/bin/validate-continuum-worktree \
  /home/chicks/workspaces/agents/continuum-control/.linear-agent-worktrees/CHI-207
  passed: isolated HOME/XDG/workspace, typecheck, 173 tests / 887 assertions,
  GOAL invariants, and CLI smoke

bunx prettier --check reviews/xdg-storage-migration/CHI-207-task-api-contract-parity-audit.md
  passed

report consistency script
  passed: 49 commit-pinned source links/ranges, required structure,
  complete coverage ledger, and 6/6 report-only dispositions

git diff --check
  passed
```

The first `bun run validate` completed its primary 173-test run successfully, then the GOAL verifier's internal second `bun test` returned exit 1 without per-test failure detail. The immediate full validation rerun and the configured isolated validation both passed without source or test changes. Commit and PR evidence are recorded in the Linear completion update.

## 11. Scope and mutation check

- Product source changed: **no**
- Tests changed: **no**
- README/docs/prompts/config changed: **no**
- Follow-up Linear issues created: **no**
- Deployment/cloud/credential/billing/destructive mutation: **no**
- Inquiry artifact added: **this file only**
- Temporary reproduction committed: **no**
