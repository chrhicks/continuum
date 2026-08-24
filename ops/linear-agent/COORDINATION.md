# Coordination contract

## Authority

| Field | Authority |
| --- | --- |
| Assignment, priority, dependencies, coordination status | Linear |
| Execution plan, discoveries, decisions, local handoff | Continuum |
| Source branch, CI, review, and merge | GitHub |

Cross-links are mandatory. A Linear issue names the Continuum task, branch, and PR. The Continuum task records the Linear identifier and URL.

## Linear workflow

The pilot uses the team's stock statuses:

```text
Backlog
  -> Todo             human marks ready
  -> In Progress      worker claim and implementation
  -> In Review        validated PR exists
  -> Done             human merge/review authority

Blocked -> Backlog + needs-human label
```

The `agent:effect` label routes eligible issues to this worker. Only a human moves work from Backlog to Todo. A scout creates backlog proposals and cannot apply the routing label or move them to Todo.

Recommended labels:

```text
agent:effect
repo:<name>
risk:data-safety
risk:migration
risk:backup
pilot
scout-proposal
needs-human
```

## Claim and lease

The worker processes one issue per run.

1. It selects a Todo issue carrying `agent:effect`.
2. It moves the issue to In Progress and comments with run ID, host, base branch, and lease expiration.
3. It re-reads the issue before touching source.
4. It stops if assignment, status, or lease no longer matches.
5. It sends a heartbeat at least every 20 minutes while active.

A later run may recover an expired lease carrying the same routing label and assignee. It must inspect the existing branch, worktree, Continuum task, comments, and PR before continuing. It must not recover another agent's live lease.

The Linear transition is not a database compare-and-swap. The re-read and one-worker lock reduce races but do not eliminate them across machines. Run one worker profile per assignee until Linear offers stronger claim semantics.

## Eligibility

An implementation issue must include:

- repository and exact allowed base branch;
- intent and observable impact;
- evidence or reproduction;
- bounded scope and explicit exclusions;
- acceptance criteria;
- validation commands;
- safety and rollback notes;
- completed dependencies.

Missing fields block the issue. The worker comments with the missing contract rather than guessing.

## Work isolation

The timer runs from a dedicated clean control checkout, never a human development checkout. Issue source changes occur in nested ignored Git worktrees:

```text
continuum-control/
  .git/
  .linear-agent-worktrees/
    CON-123-short-slug/
```

Continuum commands use the stable control checkout as their workspace. This avoids creating a separate execution ledger for every disposable worktree. Source edits and tests use the issue worktree.

The wrapper refuses to run when the control checkout is dirty. Existing issue worktrees remain until review or explicit cleanup.

## Safety

The worker may:

- read assigned Linear issues;
- update issue status and comments under this contract;
- create Continuum tasks and notes;
- create worktrees and issue branches;
- edit and validate code in the issue worktree;
- commit, push a new branch, and open a PR.

The worker may not:

- merge;
- force-push or rewrite shared history;
- deploy;
- delete or alter production data;
- mutate cloud infrastructure or credentials;
- change billing;
- execute its own scout proposals;
- broaden scope to unrelated cleanup.

Any issue requiring these operations moves to Blocked with the exact approval needed.

## Completion

In Review requires:

- acceptance criteria satisfied;
- required validation passed;
- final diff inspected;
- commit and pushed branch available;
- PR open against the requested base;
- Linear comment naming tests, PR, Continuum task, and remaining risks.

Only a human or separate review policy marks Done after merge.
