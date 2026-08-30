# Draft agent configuration

Status: simplified review draft. This does not change the deployed worker.

## Design

Use three agent roles:

1. **Scout** prepares and prioritizes work.
2. **Worker** implements one ready issue.
3. **Reviewer** reviews PRs and performs occasional codebase audits.

Systemd and the shell wrapper provide scheduling, locking, timeouts, and worktrees. The agents use clear prompts rather than elaborate isolation or policy infrastructure.

## Agent mapping

| Role | Model | Thinking | Main tools | Responsibility |
| --- | --- | --- | --- | --- |
| Scout | `openai-codex/gpt-5.6-luna` | medium | Linear, Continuum, read, grep, find, ls, read-only bash | Pick or refine the next useful item, gather evidence, define scope and acceptance criteria, and make the issue ready |
| Worker | `openai-codex/gpt-5.6-sol` | high | Linear, Continuum, read, edit, write, bash, Git, GitHub | Claim one ready issue, implement it, test it, commit, push, and open a PR to staging |
| Reviewer | `openai-codex/gpt-5.6-terra` | high | Linear, Continuum, read, grep, find, ls, bash, GitHub | Review requirements and implementation, inspect quality and complexity, approve or request changes, and create bounded follow-up proposals |

Luna and Terra are preferred for recurring preparation and review because account usage is effectively unlimited. Sol is reserved for implementation, where its coding ability is worth the higher cost.

## Timer behavior

One timer invokes one coordinator run at a time. The coordinator selects the next action in this order:

1. Review a waiting PR.
2. Implement the highest-priority ready issue.
3. Refine the best backlog candidate into a ready issue.
4. If the queue is healthy and an audit is due, run one bounded repository audit.
5. Otherwise report no work and stop.

A single tick performs one bounded action. The existing profile lock, clean-control-checkout check, worktrees, and wall-clock timeout remain.

## Scout

### Prompt expectations

- Inspect Linear, Continuum history, and relevant source.
- Pick one worthwhile candidate.
- Deduplicate against existing issues and recent work.
- Add repository, base branch, intent, evidence, scope, exclusions, acceptance criteria, validation, dependencies, and risk to the issue.
- Keep the issue small enough for one worker run.
- Mark the issue ready only when the requirements are actionable.
- Do not implement it.
- Create at most one new proposal in a run.

### Output

```text
SCOUT_READY <issue-id>
```

or:

```text
SCOUT_UPDATED <issue-id>
SCOUT_NO_WORK
```

The scout may update Linear directly. It may move a fully prepared issue to Todo and apply the worker routing label.

## Worker

### Prompt expectations

- Process one Todo issue carrying the routing label.
- Confirm dependencies and required fields before claiming it.
- Use an isolated Git worktree based on the current staging branch.
- Record implementation context in Continuum.
- Stay within scope and stop on real ambiguity.
- Run the issue validation commands.
- Inspect the final diff.
- Commit and push without force.
- Open a PR against staging, never `master`.
- Update Linear and Continuum with the handoff.
- Never merge its own PR.

### Output

```text
WORK_COMPLETE <issue-id> <pr-url>
```

or:

```text
WORK_BLOCKED <issue-id> <reason>
WORK_NO_WORK
```

## Reviewer

The same reviewer supports two modes.

### PR review mode

- Compare the ticket requirements with the actual diff and tests.
- Check correctness, regressions, complexity, duplication, unnecessary abstractions, dead code, and missing tests.
- Apply Effect-specific review when relevant.
- Apply migration or data-safety review when relevant.
- Distinguish blockers from optional follow-ups.
- Request changes when blockers exist.
- When the PR is green and acceptable, approve it for staging integration.
- Do not merge to `master`.

Output:

```text
REVIEW_PASS <issue-id> <pr-url>
```

or:

```text
REVIEW_CHANGES <issue-id> <pr-url>
```

### Repository audit mode

- Inspect one bounded area rather than the whole repository.
- Look for correctness gaps, requirement drift, excess complexity, duplication, dead code, weak tests, and Effect misuse.
- Create no more than three evidence-backed Backlog proposals.
- Deduplicate before creating anything.
- Do not implement audit findings.

Output:

```text
AUDIT_COMPLETE <area> <proposal-count>
AUDIT_NO_FINDINGS <area>
```

## Staging branch

Use a rotating staging branch based on `master`, for example:

```text
staging/agent-2026-08-24
```

- Worker issue branches start from the active staging branch.
- Worker PRs target the active staging branch.
- A passing reviewer result allows the coordinator to merge the PR into staging.
- `master` remains human-promoted through a staging-to-master PR.
- After promotion, create a fresh staging branch from updated `master`.

Linear flow:

```text
Backlog -> Todo -> In Progress -> In Review -> Staged -> Done
```

If adding a Staged status is undesirable, use In Review plus an `integration:staged` label.

## Pi invocation

Pin role settings in the worker profiles rather than inheriting ambient defaults:

```text
scout:    openai-codex/gpt-5.6-luna, medium
worker:   openai-codex/gpt-5.6-sol, high
reviewer: openai-codex/gpt-5.6-terra, high
```

Use ordinary Pi configuration, the existing MCP adapter, existing repository guidance, and the Effect skill where applicable. Dedicated containers, Unix accounts, custom schema tools, and per-role Pi homes are not required for this project.

The prompts should explicitly name permitted responsibilities and important prohibitions. Tool access can remain practical rather than minimal.

## Cost and runtime

- Do not impose dollar budgets on Luna or Terra.
- Record usage so unexpected behavior remains visible.
- Keep a wall-clock timeout for stuck processes.
- Use Sol only for active implementation.
- Do not let the Worker launch arbitrary subagents; the coordinator schedules Scout and Reviewer separately.

## Controls worth retaining

- one action or issue per run;
- local profile lock;
- clean control checkout;
- separate worktrees;
- no force-push;
- no automatic merge to `master`;
- preserve failed work;
- run validation before handoff;
- concise Linear and Continuum evidence;
- scout and audit proposal limits.

These provide a good-enough operational boundary without turning the project into an agent orchestration platform.
