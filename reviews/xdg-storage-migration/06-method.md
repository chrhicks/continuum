# Review method and evidence

## Comparison

```text
base: e693a59 add mcp server
head: 30090c3 test: isolate child process XDG storage
range: master...feature/xdg-storage-migration
```

Six commits change 64 files with 2,808 additions and 588 deletions.

## Skills and standards

The review read and applied these sources in full where relevant:

- local `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, and GOAL documents;
- Effect skill `SKILL.md`;
- Effect references for schema, services/layers, Config, and testing;
- Dillon Mulroy `coding-standards` skill;
- Dillon Mulroy `effect-service-design` skill and its audit branch;
- Dillon Mulroy `anti-slop` README and install skill;
- poteto `unslop` skill.

Upstream sources:

- `https://github.com/dmmulroy/skills`
- `https://github.com/dmmulroy/anti-slop`
- `https://github.com/poteto/noodle/.agents/skills/unslop/SKILL.md`

The Effect review also checked the installed beta source and npm tags. At review time:

```text
beta: 4.0.0-beta.107
rc:   4.0.0-rc.111
latest stable: 3.22.1
```

The branch intentionally targets beta, so the newer release candidate is not treated as an upgrade failure.

## Validation

The branch was validated independently after checkout:

```text
bun install --frozen-lockfile
bun run validate
bun test --coverage --coverage-reporter=text
git diff --check
```

Results:

- typecheck passed;
- 105 tests passed, none failed;
- formatter and GOAL invariants passed;
- repository smoke commands passed;
- branch and master coverage runs passed.

The full transcript is [data/validation.txt](data/validation.txt).

## Differential tools

### Anti-slop

The plugin was copied into a temporary runner and loaded by Oxlint 1.79.0 with every generic rule and the Effect rule enabled. It ran against isolated master and branch worktrees. No plugin or lint configuration was added to the repository.

Raw totals include pre-existing findings. The report uses the branch-minus-master delta and changed-file evidence instead of pretending the branch owns the whole baseline.

### Dependency cycles

Madge 8.0.0 processed all source files in each worktree.

Both revisions contain the same cycle:

```text
memory/application/query.ts
 -> memory/application/query-recall.ts
 -> memory/application/query.ts
```

### Duplication

jscpd 5.0.16 found the same ten exact clones and 73 duplicated lines on both revisions. The lower branch percentage comes from a larger denominator.

### Dead surface

Knip 6.32.2 was run on both worktrees. Its Bun test discovery marks tests as unused, so those file findings were discarded. Export deltas were reviewed manually.

### AST inventory

A TypeScript compiler API script parsed every changed source file and recorded:

- functions and methods;
- parameters and return annotations;
- line spans;
- exports;
- if, ternary, switch, loop, catch, and short-circuit decisions;
- explicit throws and returns;
- syntactic call edges.

This inventory is static. It does not resolve dynamic dispatch or prove runtime coverage.

## Adversarial cases

Four temporary, isolated scenarios were executed with their own HOME and XDG_DATA_HOME. They did not touch repository or user databases.

1. Replace the canonical DB with a valid empty DB after migration.
2. Rename a workspace after writing a task.
3. Restore valid bytes with an older application-version label.
4. Simulate a crash after destination migrations and before receipt publication.

All four exposed the behavior described in findings F-001 through F-004. Results are in [data/adversarial-cases.json](data/adversarial-cases.json).

These scripts live in `/tmp` and are not part of the branch. The recommended next step is to turn them into repository regression tests before changing implementation.

## Prose audit

Poteto's unslop pattern set was applied to changed branch documentation and then to the review artifacts. The scan checks common AI tells such as significance inflation, abstract AI vocabulary, promotional wording, chatbot filler, copula avoidance, and em dash use.

A pattern scan is not a substitute for editing. Each artifact was also read for unsupported claims, repetitive summary language, and generic conclusions.

## Artifact validation

The artifact check verifies:

- every Markdown link resolves locally or is an explicit URL;
- every SVG is valid XML;
- findings JSON parses;
- metrics JSON parses;
- CSV files have headers;
- no production source file changed during review;
- `git diff --check` passes.

## Limits

- The review does not prove behavior against every operating system or filesystem.
- R2 concurrency is analyzed from code and Wrangler semantics. No destructive multi-writer cloud test was run.
- The one manual cloud acceptance run from the overnight task is treated as evidence, not a repeatable automated test.
- The AST call graph is syntactic and may include library calls or miss indirect calls.
- Anti-slop rules are opinionated. Findings were accepted only when the rule exposed a concrete boundary, type, or maintenance problem.
