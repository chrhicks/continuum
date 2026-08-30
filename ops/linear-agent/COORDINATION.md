# Coordination contract

## Roles

| Role | Responsibility |
| --- | --- |
| Scout | Select and prepare one useful issue, or route ready/review work |
| Worker | Implement one ready issue and open a PR to staging |
| Reviewer | Review one PR, merge passing work to staging, or run one bounded audit |
| Human | Promote staging to `master` |

Linear owns queue state and dependencies. Continuum holds implementation plans, discoveries, and outcomes. GitHub holds branches, checks, reviews, and merges.

## Linear workflow

```text
Backlog
  -> Todo             Scout has prepared an actionable issue
  -> In Progress      Worker claimed it
  -> In Review        validated staging PR exists
  -> In Review + integration:staged
                       Reviewer merged it to staging
  -> Done             human promoted staging to master

Review changes -> Todo
Blocked -> Backlog + needs-human
```

`agent:effect` routes implementation work. `scout-proposal` marks audit proposals that still need Scout preparation. `integration:staged` records work merged into the active staging branch.

## Issue contract

Before moving an issue to Todo, the Scout ensures it contains:

- repository and exact active staging branch;
- intent and observable impact;
- evidence or reproduction;
- bounded scope and explicit exclusions;
- acceptance criteria;
- validation commands;
- safety and rollback notes;
- completed dependencies.

The Scout may apply `agent:effect` and move a complete issue to Todo. It prepares at most one issue per run.

## Worker claim

1. Select one routed Todo issue.
2. Move it to In Progress and write a lease comment.
3. Re-read before touching source.
4. Resume an existing issue branch and PR when review requested changes.
5. Stop on a competing live lease.

The three role profiles share a local lock. Linear claims remain comment-and-re-read coordination rather than an atomic lease.

## Worktrees and staging

The clean control checkout hosts ignored nested worktrees:

```text
continuum-control/
  .linear-agent-worktrees/
    CHI-123-short-slug/
```

Worker branches start from the active staging branch. PRs target staging. The Worker never merges its own PR.

The Reviewer may merge a passing PR only when its base is the exact configured staging branch. It may not merge to `master`. A human promotes the accumulated staging branch.

## Review

The Reviewer combines:

- acceptance criteria and scope verification;
- correctness and regression review;
- tests and validation evidence;
- complexity, duplication, dead code, and unnecessary abstraction;
- Effect review when relevant;
- migration and data-safety review when relevant.

Blocking findings return the issue to Todo with evidence. Optional findings may become deduplicated Backlog proposals.

## Audits

When no PR is waiting and the configured interval has elapsed, the Reviewer may inspect one bounded area. It records every evidence-backed finding without a numeric cap and deduplicates against Linear and Continuum.

Independent findings become Backlog proposals carrying `scout-proposal`. Ordered, multi-stage, or implausibly broad work becomes one campaign parent with a complete finding ledger. The Reviewer does not route or implement its findings.

## Retained limits

Agents may not:

- force-push or rewrite shared history;
- deploy;
- change credentials or billing;
- delete or alter production data;
- mutate cloud infrastructure;
- merge to `master`;
- broaden one run into unrelated cleanup.

Failed worktrees and branches remain available for recovery.
