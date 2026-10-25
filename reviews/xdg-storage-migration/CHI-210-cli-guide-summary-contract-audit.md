# CHI-210: Agent-facing CLI guide and summary contract audit

## 1. Verdict

**Primary question:** Do Continuum's agent-facing CLI guide and summary commands expose a consistent, reproducible contract for invocation, workspace selection, output shape, failure classification, and next-step guidance on the active staging branch?

**Answer: no.** The initialized `summary` success path is deterministic, its explicit workspace selection is correct, and its human/JSON output is reproducible. The overall agent-facing contract is nevertheless inconsistent in seven evidence-backed ways:

1. `summary`, advertised as the first session command, fails in a workspace with missing storage after creating identity/database artifacts; the first and later failures are classified differently, so the built-in `continuum init` fallback is not reached.
2. The task guide's create recipe uses `@-` for both description and plan; one piped stdin cannot satisfy both reads, and the command exits `0` without creating a task or printing output.
3. `guide` bypasses the shared command boundary, so `--json` still emits Markdown, `--quiet` still emits output, and an unknown topic has no stable JSON error.
4. `summary` validates numeric options and `--cwd` before entering the shared boundary, so expected failures also bypass the documented JSON envelope and stable classification.
5. Root command discovery is exit-code inconsistent: no arguments and subcommand help exit `0`, but root `--help`, `help`, and `--version` print successfully and exit `1`.
6. The summary guide still promises NOW and RECENT excerpts although the implementation and README define canonical journal/consolidation/recall evidence; `--memory-lines` does not limit pending journal entries.
7. Current tests do not protect guide flags/errors/recipes, root discovery exit codes, summary preflight errors, or missing-database behavior, allowing all six user-visible drifts to pass validation.

All findings have the required **`report-only`** disposition. This inquiry changed no product source, tests, documentation, prompts, configuration, or cloud resources and created no follow-up issue.

## 2. Baseline, scope, and method

```text
repository:  https://github.com/chrhicks/continuum
branch:      staging/xdg-storage-migration
commit:      5204616dd5d98aa8089e45e09eebbb08e6a3c767
issue:       CHI-210
policy:      report-only
worktree:    .linear-agent-worktrees/CHI-210
Bun:         1.4.2
```

The audit inspected the complete relevant command registration, parsing, workspace-access, rendering, and error boundary:

- `bin/continuum`, `src/cli.ts`, `src/cli/io.ts`, and `src/cli/memory-access.ts`;
- `src/cli/commands/guide.ts`, `summary.ts`, `summary-tasks.ts`, `summary-memory.ts`, and shared option parsing;
- the task-create input reader used by the guide recipe;
- workspace resolution and the task/memory application boundaries reached by summary;
- `README.md`, `CONTRIBUTING.md`, command help, package exports/public declarations, and repository history; and
- focused workspace, task CLI, and canonical-memory CLI tests.

Black-box commands invoked the pinned checkout's exact `bin/continuum` through Bun with isolated `HOME`, `XDG_DATA_HOME`, and disposable workspace markers. Fixtures and outputs were removed after inspection. No credentials, network service, cloud resource, destructive operation, source mutation, or LLM call was used. Storage migration internals were not audited; the report records only the directly observed CLI boundary behavior required by the issue's missing-workspace/database dimension.

Repository history establishes that guide and summary were introduced together in `2cc86548286104d97c0c89a6750b0ff6345b3803`; explicit claim/migrate summary access was added in `be08d75d01467a6c985a1e869d135daf485b184c`. No later commit added a guide command boundary or updated the summary guide's NOW/RECENT wording. The public package exports only task SDK types and the task SDK default; there is no public SDK guide or summary API to compare: [`src/sdk.d.ts:1-3`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/sdk.d.ts#L1-L3), [`src/sdk/index.ts:227`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/sdk/index.ts#L227). MCP summary schema/transport behavior is explicitly excluded by the issue; only the shared CLI renderers were inspected.

## 3. Command, option, and output matrix

| Surface/case                                                  | Observed result at pinned commit                                                                                                       | Contract conclusion                                                                |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------- |
| `continuum`                                                   | Prints root discovery help; exit `0`.                                                                                                  | Reproducible success.                                                              |
| `continuum --help` / `continuum help`                         | Prints the same root help; exit `1`.                                                                                                   | Defect CLI-005.                                                                    |
| `continuum --version`                                         | Prints `0.1.1`; exit `1`.                                                                                                              | Defect CLI-005.                                                                    |
| `continuum guide`                                             | Prints overview Markdown; exit `0`; no workspace access.                                                                               | Human success is reproducible.                                                     |
| `continuum guide <topic>`                                     | Optional topic accepts overview/task/memory/recall/summary; normalization is case-insensitive; exit `0`.                               | Reproducible; optional argument matches help.                                      |
| `continuum guide bogus`                                       | Stderr human sentence; exit `1`; no stable error code.                                                                                 | Defect CLI-003.                                                                    |
| `continuum --json guide summary`                              | Raw Markdown, not `{ ok, data, meta }`; exit `0`.                                                                                      | Defect CLI-003.                                                                    |
| `continuum --quiet guide summary`                             | Raw Markdown still printed; exit `0`.                                                                                                  | Defect CLI-003.                                                                    |
| Guide task-create recipe with one pipe                        | Exit `0`, no stdout/stderr, no task created.                                                                                           | Defect CLI-002.                                                                    |
| `continuum summary --help`                                    | Lists `--limit`, `--memory-lines`, `--no-tasks`, and `--no-memory`; exit `0`.                                                          | Reproducible discovery.                                                            |
| Initialized empty `continuum summary`                         | Markdown with workspace, zero task/memory counts, and suggested commands; exit `0`.                                                    | Reproducible success and empty state.                                              |
| Initialized populated summary                                 | Shows status-grouped tasks, canonical evidence, and next-task command; exit `0`.                                                       | Reproducible success.                                                              |
| `--json ... summary` on success                               | `{ ok: true, data: { output: <Markdown> }, meta: { cwd, durationMs } }`; exit `0`.                                                     | Intentional machine wrapper around deterministic Markdown.                         |
| `--quiet ... summary` on success                              | No stdout/stderr; exit `0`.                                                                                                            | Matches documented global quiet behavior.                                          |
| `summary --no-tasks` / `--no-memory`                          | Omits only the named section; still emits header/workspace/suggestions.                                                                | Intentional presentation difference.                                               |
| Both `--no-tasks --no-memory`                                 | Emits header/workspace/suggestions only.                                                                                               | Reproducible; options say “omit,” not “disable command.”                           |
| `summary --limit 0                                            | nope`                                                                                                                                  | Human message on stderr; exit `1`; JSON request does not produce JSON.             | Defect CLI-004. |
| `summary --memory-lines -2`                                   | Human message on stderr; exit `1`; JSON request does not produce JSON.                                                                 | Defect CLI-004.                                                                    |
| JSON summary with absent/file `--cwd`                         | Human `stat`/directory error on stderr; exit `1`; no envelope.                                                                         | Defect CLI-004.                                                                    |
| Initialized explicit nested `--cwd`                           | Resolves upward to the workspace marker; JSON `meta.cwd` and body workspace are the root; ambient cwd is unchanged in in-process test. | Workspace selection confirmed.                                                     |
| Missing database under an empty workspace marker              | First summary creates identity/database files, exits `1` with JSON code `UNKNOWN_ERROR`; retry reports `STORAGE_MIGRATION_CONFLICT`.   | Defect CLI-001; storage internals excluded.                                        |
| Global options after the subcommand                           | Commander currently accepts tested root options after `summary`/`guide`, although README says they must precede.                       | Benign permissiveness, not a defect. Canonical documented form was used elsewhere. |
| Summary storage/application failure inside `runMemoryCommand` | Shared boundary emits JSON code/message/meta or human `CODE: message`; exit `1`.                                                       | Stable once execution has entered the boundary.                                    |

Representative successful JSON shape:

```json
{
  "ok": true,
  "data": {
    "output": "# Continuum Summary\n\nWorkspace: <fixture>\n..."
  },
  "meta": {
    "cwd": "<fixture>",
    "durationMs": 14
  }
}
```

Representative boundary failures:

```text
$ continuum --json --cwd <initialized> summary --limit nope
status 1; stdout empty
stderr: Limit must be a positive integer.

$ continuum --json guide bogus
status 1; stdout empty
stderr: Unknown guide topic 'bogus'. Use: overview, task, memory, recall, summary.

$ printf 'one shared stdin\n' | continuum --cwd <initialized> task create \
    --title x --type chore --description @- --plan @-
status 0; stdout empty; stderr empty; subsequent task list is empty
```

## 4. Complete coverage ledger

| Requested dimension                 | Evidence-backed conclusion                                                                                                                                                                                                           | Finding/disposition                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Command discovery                   | Root and subcommand help enumerate the intended guide/summary surfaces. Root help/version success is misreported as failure.                                                                                                         | CLI-005, `report-only`.                                            |
| Guide required/optional arguments   | Topic is optional; documented topics work; unknown topic fails clearly in human text but bypasses standard formatting.                                                                                                               | CLI-003, `report-only`.                                            |
| Summary required/optional arguments | No positional arguments; four documented options; positive integer rules enforced. Validation occurs outside the standard boundary.                                                                                                  | CLI-004, `report-only`.                                            |
| Workspace identity/path selection   | Valid absolute or relative `--cwd` resolves from invocation cwd and walks upward to the nearest `.continuum`/`.git`; summary does not change ambient cwd.                                                                            | Confirmed behavior; no finding.                                    |
| Guide workspace behavior            | Static guide needs no workspace, but global `--cwd` pre-action still attempts `chdir`; an absent target fails before formatting.                                                                                                     | Included in CLI-003/CLI-004 boundary pattern; no separate finding. |
| Defaults                            | Summary defaults to five tasks per status bucket and three consolidation/recall summaries. Guide defaults to overview.                                                                                                               | Confirmed behavior.                                                |
| Empty results                       | Initialized empty summary explicitly reports zero task and memory counts and gives next-step commands.                                                                                                                               | Confirmed behavior.                                                |
| Malformed input                     | Unknown guide topic, invalid summary integers, excess summary positional input, and invalid cwd all exit nonzero. Only Commander syntax errors and in-boundary failures have predictable handling; JSON is not universal.            | CLI-003/CLI-004, `report-only`.                                    |
| Missing workspace/database          | Missing path fails before JSON formatting. An existing workspace marker with no database mutates then fails, and retry classification changes.                                                                                       | CLI-001/CLI-004, `report-only`.                                    |
| Human-readable output               | Guide and summary Markdown are readable and deterministic on valid initialized input. Summary presents named task/memory/suggestion sections.                                                                                        | Confirmed behavior except stale guide claims in CLI-006.           |
| Machine-readable output             | Initialized summary has the documented envelope and a stable `data.output` Markdown field. Guide ignores JSON; summary preflight failures ignore it.                                                                                 | CLI-003/CLI-004, `report-only`.                                    |
| Exit status                         | Ordinary success `0`, ordinary failure `1`; root help/version incorrectly `1`; guide's unusable dual-stdin recipe incorrectly `0`.                                                                                                   | CLI-002/CLI-005, `report-only`.                                    |
| Failure classification              | In-boundary typed failures preserve code/message; plain errors become `UNKNOWN_ERROR`. Guide and summary preflight errors bypass classification entirely; missing-database retries change classification.                            | CLI-001/CLI-003/CLI-004, `report-only`.                            |
| Next-step guidance                  | Initialized empty/populated summary chooses ready/open/blocked inspection or list commands appropriately. Fresh-workspace init guidance is unreachable in the observed missing-database path; one task-guide recipe is unusable.     | CLI-001/CLI-002, `report-only`.                                    |
| Summary task data                   | Active/ready/open/blocked/recently completed buckets and next-task detail use one task service/renderer; limit is per rendered bucket.                                                                                               | Confirmed behavior.                                                |
| Summary memory data                 | Reads canonical journal, consolidation, and recall evidence; all pending journal entries are rendered, while only consolidation/recall groups use `--memory-lines`.                                                                  | CLI-006, `report-only`.                                            |
| Public APIs/types                   | Public package SDK exports task APIs only. Guide/summary command constructors and renderers are internal; MCP output contracts are excluded.                                                                                         | Explicit no-finding/no public parity claim.                        |
| Documentation/help                  | README accurately says summary queries canonical SQLite and lists options. Summary guide retains obsolete NOW/RECENT language; task guide advertises an impossible stdin recipe.                                                     | CLI-002/CLI-006, `report-only`.                                    |
| Focused tests                       | Existing tests cover valid explicit cwd, initialized summary content, memory limits, JSON success, and workspace resolution. They omit every confirmed defect path.                                                                  | CLI-007, `report-only`.                                            |
| Environment-dependent/untested      | No DB-busy/corruption, legacy migration internals, symlink ambiguity, installed-link packaging, cloud, credential, MCP schema, backup, or LLM behavior was tested. Those are excluded or unnecessary to answer the primary question. | Explicitly untested; no inferred finding.                          |

Every requested dimension has either an evidence-backed finding or an explicit evidence-backed no-finding/untested conclusion.

## 5. Prioritized findings

### CLI-001 — P1 — `summary` cannot fulfill its advertised first-command contract when the database is missing

**Direct answer.** Workspace/database failure and next-step behavior are not reproducible as documented.

The guide says “Use summary as the first command in an agent session”: [`src/cli/commands/guide.ts:140-149`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/cli/commands/guide.ts#L140-L149). Task summary code explicitly models `NOT_INITIALIZED`, renders `initialize: continuum init`, and the suggestion builder has a corresponding init branch: [`src/cli/commands/summary-tasks.ts:20-62`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/cli/commands/summary-tasks.ts#L20-L62), [`src/cli/commands/summary.ts:89-109`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/cli/commands/summary.ts#L89-L109).

The command instead selects `claim-migrate-scoped` access before rendering and the shared memory boundary claims authority and prepares canonical storage before task summary is loaded: [`src/cli/commands/summary.ts:33-55`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/cli/commands/summary.ts#L33-L55), [`src/cli/io.ts:156-185`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/cli/io.ts#L156-L185).

In a disposable workspace containing an empty `.continuum/` marker and no database, the first JSON invocation created `workspace.json`, canonical database, WAL, SHM, and registry files, then exited `1` with code `UNKNOWN_ERROR` and a divergence message. A retry exited `1` as `STORAGE_MIGRATION_CONFLICT`. It never rendered the designed init guidance. This report does not diagnose or propose changes to storage migration semantics; it reports the observable guide/summary boundary mismatch required by CHI-210.

**Impact.** The recommended first agent command cannot bootstrap or truthfully guide a clean/missing-database workspace, performs writes despite appearing to be a briefing, and does not offer stable failure classification across retries.

**Bounded recommendation.** Human triage should make the advertised contract explicit: either make summary a read-only inspection that deterministically reports “not initialized” plus `continuum init`, or document and test its initialization/migration authority and ensure a clean first invocation completes deterministically. Preserve one stable error classification for equivalent retries.

**Disposition:** `report-only`. No implementation or follow-up issue was created.

### CLI-002 — P1 — The task guide's dual-stdin create recipe silently performs no operation

**Direct answer.** One primary guide command is not reproducible.

The task guide advertises:

```text
continuum task create ... --description @- --plan @-
```

at [`src/cli/commands/guide.ts:80-83`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/cli/commands/guide.ts#L80-L83). The create adapter reads description and then plan sequentially from the same process stdin: [`src/cli/commands/task/crud.ts:192-224`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/cli/commands/task/crud.ts#L192-L224). `readInput('@-')` consumes stdin through a fresh event-listener promise: [`src/cli/io.ts:68-95`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/cli/io.ts#L68-L95), [`src/cli/io.ts:222-231`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/cli/io.ts#L222-L231).

With one piped line in an initialized disposable workspace, the first read consumed the stream, the second read never resolved, Bun exited because no live handle remained, and the process reported status `0` with no output. A subsequent JSON task list was empty. No task was created.

**Impact.** An agent following the authoritative task guide receives a false-success exit and can proceed believing durable task context exists when nothing was recorded.

**Bounded recommendation.** Advertise a reproducible single-input method (for example `--input @-` with one JSON object, one stdin-backed field plus an inline/file-backed second field, or separate documented calls). Add a black-box assertion that every guide recipe either mutates as promised or fails nonzero with a diagnostic.

**Disposition:** `report-only`. No implementation or follow-up issue was created.

### CLI-003 — P1 — `guide` does not honor global JSON, quiet, or stable-error contracts

**Direct answer.** Guide output and failures are inconsistent with the repository's unqualified global-option contract.

README says `--json` emits `{ ok, data, meta }` envelopes and `--quiet` suppresses human output: [`README.md:31-37`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/README.md#L31-L37). The shared boundary implements exactly those rules and central error formatting: [`src/cli/io.ts:117-153`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/cli/io.ts#L117-L153), [`src/cli/io.ts:188-219`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/cli/io.ts#L188-L219).

`guide` calls `console.log` directly and throws a plain error directly: [`src/cli/commands/guide.ts:7-32`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/cli/commands/guide.ts#L7-L32). Consequently:

- `continuum --json guide summary` exits `0` with raw Markdown;
- `continuum --quiet guide summary` exits `0` with the same raw Markdown; and
- `continuum --json guide bogus` exits `1` with only human stderr and no code/envelope.

An absent global `--cwd` target also fails in the pre-action `chdir` before any standard formatting: [`src/cli.ts:105-116`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/cli.ts#L105-L116).

**Impact.** Agent automation cannot safely request machine-readable guide output, suppress it, or classify expected guide failures using the documented global interface.

**Bounded recommendation.** Route guide success and expected failures through the same command boundary, with a named guide result field and stable invalid-topic code, or explicitly narrow the global-option documentation and help to commands that implement it. The former is more consistent with the agent-facing role.

**Disposition:** `report-only`. No implementation or follow-up issue was created.

### CLI-004 — P2 — Summary preflight validation bypasses its otherwise stable JSON boundary

**Direct answer.** Summary's success and in-execution failure shapes are reproducible, but option/path failures are not serialized by the same contract.

`summary` parses both positive integers and resolves/stat-checks CLI memory access before calling `runMemoryCommand`: [`src/cli/commands/summary.ts:22-55`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/cli/commands/summary.ts#L22-L55). `resolveCliMemoryAccess` uses an unwrapped `statSync` and throws its own directory error: [`src/cli/memory-access.ts:23-46`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/cli/memory-access.ts#L23-L46). Only afterward does `runMemoryCommand` enter `runCommand`, where JSON envelopes and stable error mapping live.

Black-box JSON requests using `--limit nope`, `--memory-lines -2`, an absent `--cwd`, or a file as `--cwd` all exited `1` with empty stdout and human stderr. By contrast, failures thrown after entry into `runMemoryCommand` emitted `{ ok: false, error, meta }`.

**Impact.** A JSON caller must maintain two error parsers for one command and cannot assume that malformed input or invalid workspace selection returns JSON.

**Bounded recommendation.** Move summary option/access validation into the shared executor or introduce one root command boundary that wraps preflight as well as application execution. Assign stable validation/path codes rather than generic messages.

**Disposition:** `report-only`. No implementation or follow-up issue was created.

### CLI-005 — P2 — Root help and version report successful discovery as exit `1`

**Direct answer.** Command discovery is readable but has an incorrect, inconsistent process contract.

The root program enables Commander's `exitOverride`, and `main` maps every `CommanderError` to exit `1` without preserving the Commander's original exit code: [`src/cli.ts:20-38`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/cli.ts#L20-L38), [`src/cli.ts:41-70`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/cli.ts#L41-L70). With the pinned executable:

| Invocation                 | Output         | Exit |
| -------------------------- | -------------- | ---- |
| `continuum`                | Root help      | `0`  |
| `continuum --help`         | Same root help | `1`  |
| `continuum help`           | Same root help | `1`  |
| `continuum --version`      | `0.1.1`        | `1`  |
| `continuum guide --help`   | Guide help     | `0`  |
| `continuum summary --help` | Summary help   | `0`  |

**Impact.** Shell automation, installers, and agent probes treat successful root discovery/version checks as command failures.

**Bounded recommendation.** Preserve the Commander's exit code for help/version display while retaining nonzero status for parse errors. Add subprocess tests for root and subcommand discovery.

**Disposition:** `report-only`. No implementation or follow-up issue was created.

### CLI-006 — P2 — The summary guide describes obsolete memory sources and limit semantics

**Direct answer.** Help and implementation do not expose one current summary content contract.

The summary guide says output includes “current NOW memory excerpt” and “RECENT memory excerpt”: [`src/cli/commands/guide.ts:140-158`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/cli/commands/guide.ts#L140-L158). README says the opposite: summary queries canonical SQLite directly and does not read `NOW.md`, `RECENT.md`, or `MEMORY.md`: [`README.md:124-128`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/README.md#L124-L128).

Implementation groups canonical evidence into pending journals, consolidations, and recall evidence. It renders every pending journal entry, while `summaryLimit` slices only consolidations and recall: [`src/cli/commands/summary-memory.ts:3-24`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/cli/commands/summary-memory.ts#L3-L24). Command help accurately calls `--memory-lines` the maximum recent consolidation and recall summaries: [`src/cli/commands/summary.ts:22-32`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/src/cli/commands/summary.ts#L22-L32). Focused tests confirm four pending entries all render while only three consolidations render: [`tests/memory-cli-cutover.test.ts:124-140`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/tests/memory-cli-cutover.test.ts#L124-L140).

**Impact.** Agents using the guide infer projection-file source semantics and a line/excerpt cap that no longer exist. Large pending journals are not constrained by the option whose name implies a line cap.

**Bounded recommendation.** Align the guide with canonical evidence terminology and state exactly which groups `--memory-lines` limits. If bounded total output is desired, that is a separate product decision; this inquiry does not redesign it.

**Disposition:** `report-only`. No implementation or follow-up issue was created.

### CLI-007 — P2 — Focused tests do not define the full agent-facing contract

**Direct answer.** Existing tests cover valid summary data but not the boundaries agents rely on for discovery and automation.

The canonical-memory CLI suite verifies:

- valid explicit `--cwd` does not consult or mutate ambient cwd;
- initialized summary reads canonical data without projections;
- full pending content and consolidation limit behavior; and
- initialized JSON summary returns `data.output`.

See [`tests/memory-cli-cutover.test.ts:61-89`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/tests/memory-cli-cutover.test.ts#L61-L89) and [`tests/memory-cli-cutover.test.ts:94-204`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/tests/memory-cli-cutover.test.ts#L94-L204). Workspace unit tests verify marker walking and explicit target precedence: [`tests/workspace.test.ts:23-77`](https://github.com/chrhicks/continuum/blob/5204616dd5d98aa8089e45e09eebbb08e6a3c767/tests/workspace.test.ts#L23-L77).

No current test references `guide`, unknown guide topics, global JSON/quiet behavior for guide, executable guide recipes, root help/version exit status, summary malformed integers, invalid `--cwd`, or missing database. The original guide content test introduced in commit `2cc8654` was later removed; current search finds no guide test.

**Impact.** Full validation can pass while every preceding contract defect remains present. The documented global interface is not executable as one regression contract.

**Bounded recommendation.** After human disposition, add a subprocess contract matrix covering help/version exits, guide topics and recipes, global JSON/quiet behavior, summary success/empty/error shapes, valid/invalid workspace selection, and missing-database next steps. Keep storage-internal assertions outside this suite.

**Disposition:** `report-only`. No implementation or follow-up issue was created.

## 6. Confirmed intentional differences and no-finding results

- **Initialized summary workspace selection is correct.** Explicit `--cwd` is resolved from invocation cwd, walks upward to the nearest marker, and is passed explicitly into the scoped runtime. In-process tests confirm ambient cwd remains unchanged for summary.
- **Initialized empty state is useful.** The human output distinguishes zero active tasks and zero memory evidence and recommends a ready-task list plus memory search.
- **Task ordering is deliberate.** Summary sorts active tasks by priority, then chooses the first ready task, otherwise open, otherwise blocked, matching the guide's ready-first workflow. Each rendered bucket obeys `--limit`.
- **Human versus JSON success is an intentional transport presentation.** Human summary is Markdown; JSON wraps the same deterministic Markdown in `data.output` and adds `meta.cwd`/duration. The issue did not require a field-by-field structured summary.
- **Section omission is literal.** `--no-tasks` and `--no-memory` omit sections but retain common headings/suggestions. Passing both is therefore meaningful and not itself a defect.
- **Errors remain visible under `--quiet`.** The implementation suppresses successful human rendering but retains stderr failures. This is a conventional quiet-mode interpretation and was not treated as drift.
- **Options after subcommands are permissively accepted.** README's “must precede” form remains valid; broader Commander acceptance is not harmful.
- **No public SDK contract exists for guide/summary.** The package's public SDK surface is task-only. Internal renderer reuse does not create a public API promise.
- **No finding is inferred for MCP, backup, migration correctness, or LLM behavior.** Those areas are excluded; only directly observable CLI boundary evidence was used.

## 7. Validation and reproducibility

The black-box matrix used commands of these forms against isolated fixtures:

```sh
bun bin/continuum --help
bun bin/continuum --version
bun bin/continuum guide --help
bun bin/continuum --json guide summary
bun bin/continuum --quiet guide summary
bun bin/continuum --json guide bogus
bun bin/continuum --cwd <initialized> summary
bun bin/continuum --json --cwd <initialized> summary
bun bin/continuum --quiet --cwd <initialized> summary
bun bin/continuum --cwd <initialized> summary --no-tasks --no-memory
bun bin/continuum --json --cwd <initialized> summary --limit nope
bun bin/continuum --json --cwd <missing> summary
printf 'one shared stdin\n' | bun bin/continuum --cwd <initialized> task create \
  --title x --type chore --description @- --plan @-
```

Validation results:

- `bun test tests/memory-cli-cutover.test.ts tests/workspace.test.ts tests/task-cli-parse.test.ts` — **18 passed, 0 failed**;
- `bun run validate` — **passed**: typecheck, **181 tests / 930 expectations**, and all GOAL invariants;
- `/home/chicks/workspaces/agents/continuum-control/ops/linear-agent/bin/validate-continuum-worktree <worktree>` — **passed** in its isolated HOME/XDG/workspace fixture, again with **181 tests / 930 expectations** and all invariants;
- `prettier --check` for this report — **passed**;
- `git diff --check` — **passed**; and
- pinned-link validation — **28 links** resolved to existing files and in-range lines at the pinned checkout.

The artifact was also checked for complete coverage, seven finding headings, seven report-only finding dispositions, and internal consistency. No prohibited product change or follow-up issue was made.

## 8. Disposition ledger

| ID      | Priority | Finding                                                                                                         | Disposition   |
| ------- | -------- | --------------------------------------------------------------------------------------------------------------- | ------------- |
| CLI-001 | P1       | Missing-database summary contradicts first-command/init-guidance contract and has unstable retry classification | `report-only` |
| CLI-002 | P1       | Guide's dual-stdin task-create recipe silently exits success without creating a task                            | `report-only` |
| CLI-003 | P1       | Guide bypasses global JSON, quiet, and stable-error behavior                                                    | `report-only` |
| CLI-004 | P2       | Summary preflight option/path failures bypass the JSON/error boundary                                           | `report-only` |
| CLI-005 | P2       | Root help/version print successfully but exit nonzero                                                           | `report-only` |
| CLI-006 | P2       | Summary guide retains obsolete NOW/RECENT and memory-limit wording                                              | `report-only` |
| CLI-007 | P2       | Tests omit the executable cross-cutting guide/summary contract                                                  | `report-only` |

No duplicate, rejected, deferred, backlog-proposal, or campaign-ledger disposition applies. Policy is report-only, so no Linear follow-up was created.

## 9. Final primary-question check

The verdict still answers the original primary question rather than a general architecture concern: initialized summary success behavior is largely consistent and reproducible, but the combined guide/summary CLI contract is **not** consistent across discovery exits, guide global flags, summary preflight errors, missing database handling, documented recipes, memory-source wording, and test enforcement. Actionable human follow-up is warranted for all seven report-only findings, with CLI-001 through CLI-003 prioritized because they can mislead or break agent startup and durable task recording.
