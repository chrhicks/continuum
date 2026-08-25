# Coordination contract

## Roles

| Role | Responsibility |
| --- | --- |
| Scout | Reconcile the queue, preserve intent, prepare one issue, or advance one campaign item |
| Worker | Execute one bounded implementation or inquiry and open a PR to staging |
| Reviewer | Review one PR, merge passing work to staging, or run one bounded repository inquiry |
| Human | Author protected intent and promote staging to `master` |

Linear owns queue state, work shape, dependencies, and campaign ledgers. Continuum holds plans, discoveries, decisions, and outcomes. GitHub holds branches, checks, reviews, and staging merges.

## Work shapes

### Execution

One bounded implementation or documentation outcome that fits one Worker run. No workflow label is required.

### Inquiry

An audit, discovery, investigation, research task, review, or design exercise whose deliverable is knowledge rather than an implementation. It carries `workflow:inquiry` and declares one finding-disposition policy:

- `report-only`;
- `backlog-proposals`; or
- `campaign-ledger`.

Findings and report contents are never capped.

### Campaign

A durable parent for multiple outcomes. It carries `workflow:campaign`, never carries `agent:effect`, and maintains a complete `## Campaign ledger`. The Scout prepares one child per run and links parent/dependency relations. The parent remains Backlog while items remain and moves to In Review after every item is staged, duplicated, rejected, or deferred.

Campaign semantics dominate when an issue also carries `workflow:inquiry`.

## Protected human intent

`source:human` protects an issue's title, primary objective, requested emphasis, exclusions, deliverable, and completion condition. Scout preparation is appended rather than substituted. A broad human issue without `workflow:campaign` stalls for clarification instead of being narrowed into one task.

## Linear workflow

```text
Execution or inquiry
  Backlog
    -> Todo             Scout prepared an actionable contract
    -> In Progress      Worker claimed it
    -> In Review        validated staging PR exists
    -> In Review + integration:staged
                         Reviewer merged it to staging
    -> Done             human promoted/disposed staging

Campaign
  Backlog               ledger has pending work
    -> child Todo/In Progress/In Review/staged
    -> next child
    -> In Review        every ledger item has durable disposition
    -> Done             human promotion/disposition

Review changes -> Todo
Blocked -> Backlog + needs-human
```

## Labels

- `agent:effect` routes execution and inquiry children to Worker.
- `scout-proposal` marks an unprepared automated proposal.
- `integration:staged` records a PR merged into active staging.
- `source:human` protects human-authored intent.
- `workflow:inquiry` selects inquiry semantics.
- `workflow:campaign` selects parent/campaign semantics.

## Preparation contracts

Before moving execution work to Todo, Scout ensures it contains repository, exact staging branch, intent, evidence, bounded scope, exclusions, acceptance criteria, validation, safety, dependencies, and source links.

Before moving inquiry work to Todo, Scout ensures it contains the primary question, requested dimensions, evidence range, artifact, coverage expectations, artifact validation, exclusions, finding-disposition policy, and completion condition.

Scout prepares or creates at most one issue or campaign child per run. This is a mutation bound, not a limit on findings or campaign size.

## Worker claim

1. Select one routed Todo issue that is not a campaign parent.
2. Move it to In Progress and write a lease comment.
3. Re-read before touching source.
4. Resume an existing issue branch and PR for requested changes.
5. Stop on a competing live lease.
6. Preserve human intent and campaign-child scope.

The profiles share a local lock. Linear claims remain comment-and-re-read coordination rather than an atomic lease.

## Worktrees and staging

The clean control checkout hosts ignored nested worktrees:

```text
continuum-control/
  .linear-agent-worktrees/
    CHI-123-short-slug/
```

Worker branches start from the active staging branch. PRs target staging. Worker never merges its own PR.

Reviewer may merge a passing PR only when its base is the exact staging branch. It may not merge to `master`. Human promotion remains separate.

## Review

Reviewer combines acceptance, correctness, regression, validation, complexity, Effect, and data-safety review.

For inquiries, Reviewer also verifies the original question was answered, every requested dimension has evidence or an explicit no-finding conclusion, every evidence-backed finding is present, and each finding has the required disposition. Adjacent architectural observations may not replace the requested concern.

Blocking findings return the issue to Todo with evidence.

## Scheduled repository inquiries

When no PR is waiting and the interval has elapsed, Reviewer may inspect one bounded area. It records every evidence-backed finding without a numeric cap and deduplicates against Linear and Continuum.

Independent findings become Backlog `scout-proposal` issues. An ordered or multi-stage result becomes one `workflow:campaign` parent with a complete ledger. Reviewer does not route or implement its findings.

## Retained limits

Agents may not:

- force-push or rewrite shared history;
- deploy;
- change credentials or billing;
- delete or alter production data;
- mutate cloud infrastructure;
- merge to `master`;
- launch child agents; or
- broaden one run into unrelated work.

Failed worktrees and branches remain available for recovery.
