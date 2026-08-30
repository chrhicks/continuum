# Pipeline findings

The findings JSON is available at [data/findings.json](data/findings.json). P0 and P1 findings should be addressed before unattended polling resumes.

## PIP-001 P0: empty polling launches the full coding model

Evidence:

- `ops/linear-agent/systemd/linear-agent-worker@.timer`
- `ops/linear-agent/bin/run-once`
- [measured runs](data/runs.json)

The timer starts `run-once` every five minutes after the previous service becomes inactive. `run-once` launches Pi before asking Linear whether work exists.

The live NO_WORK run lasted 71 seconds and cost $0.354413. At a five-minute interval this projects to $102.07 per idle day. Including average random jitter lowers that only to about $97.21. A 30-day idle worker would project to $2,916-$3,062.

This alone can exhaust an account limit without completing work.

Required change: query Linear through a deterministic process first. Start Pi only after one eligible issue has been validated and claimed. A webhook can replace polling later, but cheap polling is sufficient initially.

## PIP-002 P0: the coding model runs inside the credential boundary

Evidence:

- systemd security exposure: `7.5 EXPOSED`;
- `ProtectHome` is not set;
- `gh` token has `repo`, `gist`, `read:org`, and `admin:public_key` scopes;
- SSH, Pi auth, gh config, and Cloudflare secrets live under the same home;
- Executor exposes 107 integration/core tools;
- no Executor policy exists;
- MCP direct tools have no include, exclude, or adapter approval list;
- recorded sessions contain 16 agent-issued `resume` calls.

The worker prompt says never merge, force-push, deploy, read secrets, mutate cloud resources, or change policy. None of those restrictions is enforced by the process.

Executor's pause mechanism does not create human approval in this topology. The same model receives the `resume` tool and accepted its own paused writes during normal Linear handoff.

Required change:

1. Put Linear, Continuum, GitHub, and Executor credentials in a deterministic supervisor.
2. Run Pi under a dedicated account or container with one worktree writable.
3. Do not mount SSH, gh, Cloudflare, or broad user configuration.
4. Remove Executor core policy/provider/resume tools from the coding session.
5. Have the supervisor commit, push, open the PR, and update coordination state.

## PIP-003 P1: dispatch and claims are model behavior

The shell wrapper does not inspect Linear. The model decides:

- whether work exists;
- whether dependencies are complete;
- whether the issue contract is sufficient;
- which issue has highest priority;
- whether a base branch is allowed;
- whether a lease conflicts;
- whether recovery is safe.

The protocol produced correct behavior in two examples. That is useful evidence, not a state-machine guarantee.

Required change: implement `dispatch-once` as ordinary code. It should query exact fields, validate a versioned issue schema, enforce assignee/project/label/state/base/dependencies, claim one issue, re-read once, and write a frozen run envelope.

## PIP-004 P1: issue and repository content can redirect a privileged run

Linear descriptions and comments are editable text. The worker reads them as both requirements and commands. The prompt does not explicitly state that issue content is untrusted and cannot override the protocol.

Pi also starts with `--approve`, which trusts control-checkout project resources. Pi loads global extensions and packages. Pi documentation warns that packages execute arbitrary code with full system access.

Required change:

- parse issue fields outside the model;
- pass a frozen data object, not an open-ended issue transcript;
- keep allowed validation commands in reviewed repository configuration;
- launch Pi with an explicit minimal resource and tool set;
- pin any loaded extension or package;
- treat web, issue, comment, and repository text as untrusted input.

## PIP-005 P1: cost is bounded by time, not budget

![Measured costs](diagrams/cost-profile.svg)

CHI-99 demonstrates the gap:

| Portion | Cost |
| --- | ---: |
| parent worker | $2.519003 |
| four subagent sessions | $10.009393 |
| combined | $12.528396 |

The global `pi-subagents` package was available to the worker and created four child sessions. No profile setting limits child count, turns, model, thinking, token use, or dollars. The 90-minute timeout limits elapsed time only.

Required change:

- pin model and thinking in the profile;
- disable subagents by default for routine tickets;
- allow a bounded child count only for approved issue classes;
- parse session usage and stop before a per-run budget;
- record cost in the Linear handoff and Continuum outcome.

## PIP-006 P1: the control ledger has two Continuum authorities

CHI-98 created a durable example:

- typed Continuum tools through Executor used one runtime/storage generation;
- shell validation used another globally installed generation;
- both a legacy local DB and XDG canonical DB existed;
- the second run reported `STORAGE_MIGRATION_CONFLICT`.

The isolated validation helper is the correct response for code validation. It preserves both control databases. It does not make ledger reads and writes consistent.

Required change:

- pin the exact Continuum executable behind Executor and shell operations;
- expose its runtime version and canonical database identity;
- preflight both before claiming an issue;
- fail before coordination writes when they differ;
- reconcile existing stores only through reviewed, explicit migration.

## PIP-007 P1: service success does not mean pipeline success

The wrapper uses Pi text mode, tees the final response, and returns Pi's process status.

Observed results:

```text
NO_WORK   exit 0, systemd success
BLOCKED   exit 0, systemd success
HANDOFF   exit 0, systemd success
```

The supervisor does not verify that a branch exists, commit was pushed, PR targets the expected base, Linear has the expected status, or Continuum recorded the outcome. A model could report success without completing those actions.

Required change:

- run Pi in JSON or RPC mode;
- require a versioned result schema;
- independently inspect Git, PR, Linear, Continuum, and validation artifacts;
- emit distinct results and exit codes for no-work, blocked, handoff, malformed output, timeout, and infrastructure failure;
- notify on blocked and failure outcomes.

## PIP-008 P2: leases are prose

A lease is a Linear comment interpreted by later models. Local `flock` is effective on one profile and host, but it is unrelated to the Linear lease.

CHI-98 recovery needed a human comment releasing the first unexpired lease. If a process crashes early, repeated five-minute runs may spend model tokens discovering that the lease is still live until its two-hour expiry.

Required change:

- keep one dispatcher host initially;
- store issue, PID, branch, state, expiry, heartbeat, and session path in a durable local run record;
- have the supervisor release or expire it based on process state;
- add a real compare-and-swap lease before supporting multiple machines.

## PIP-009 P2: CI and deployed versions are not reconciled

The handoff moves Linear to In Review after local validation and PR creation. CI was still pending in the CHI-98 final response. Both observed PRs later passed, but no watcher would have reacted to failure.

The installed wrapper and prompt are copies. The helper remains in the control checkout. Model and thinking come from ambient Pi defaults. Pi, adapter, subagents, Continuum integration, checkout, installed script, and prompt can drift independently.

Required change:

- define whether In Review means PR open or CI green;
- add a check watcher and move failures to Blocked;
- record Pi, model, thinking, adapter, Continuum, source commit, and script/prompt hashes in every run;
- install from an immutable release or verified commit.

## PIP-010 P2: operational coverage and lifecycle are incomplete

The shell smoke test covers:

- syntax;
- install modes;
- dry run;
- dirty checkout refusal;
- insecure config rejection.

It does not automate:

- Linear selection and contract parsing;
- claim races;
- lease recovery;
- timeout behavior;
- lock contention;
- systemd timer semantics;
- validation helper success;
- structured handoff verification;
- malicious issue content;
- CI failure reconciliation.

Run prompts, text logs, Pi sessions, subagent artifacts, branches, and worktrees have no retention or cleanup policy. The service has no `OnFailure` notification.

Required change: add fake Linear/GitHub/Pi integration tests, status and alert tooling, bounded retention, and human-approved cleanup after merge.
