# Review method and evidence

## Scope

This phase reviews only the Linear-to-Pi coordination and execution pipeline. It does not map pipeline findings to the XDG storage branch review. That mapping is a separate next phase.

Reviewed source:

```text
branch: ops/linear-agent-worker
commit: c9798b5
path:   ops/linear-agent/
```

Reviewed deployment:

```text
host: chicks-arch
control: /home/chicks/workspaces/agents/continuum-control
service: linear-agent-worker@continuum.service
timer: linear-agent-worker@continuum.timer
```

Polling was disabled after CHI-99 completed and before detailed review.

## Sources

- all worker shell scripts, prompts, systemd units, configuration example, issue template, coordination contract, and smoke test;
- Pi 0.84.2 README and CLI behavior;
- `pi-mcp-adapter` 2.24.0 README, especially project trust, direct tools, approval behavior, and script mode;
- deployed Pi settings and MCP config with credentials redacted;
- Executor integration inventory and policy list;
- systemd security analysis;
- gh authentication scope output with token redacted;
- Linear project, issue states, comments, leases, and handoffs;
- Git worktrees, commits, PRs, and CI checks;
- wrapper logs and Pi JSONL sessions.

## Dynamic runs

Four live parent runs were reviewed:

| Run | Result | Cost |
| --- | --- | ---: |
| no-work check | `NO_WORK` | $0.354413 |
| CHI-98 first attempt | `BLOCKED` | $1.937066 |
| CHI-98 recovery | PR #7, In Review | $1.451670 |
| CHI-99 parent | PR #8, In Review | $2.519003 |

CHI-99 also created four subagent sessions costing $10.009393. Total observed live cost was $16.271545.

The cost values are provider-reported session totals. Projection assumes the measured no-work run remains representative and does not include price or prompt-cache changes.

## Security checks

The review inspected:

- effective systemd hardening through `systemd-analyze --user security`;
- whether `ProtectHome` was set;
- writable and readable user scope;
- GitHub token scopes;
- Executor integration counts and policies;
- MCP direct/include/exclude/approval settings;
- tool-call names in session files;
- agent-issued `resume` calls;
- Pi project trust and package execution semantics.

No credential values were read or copied into artifacts.

## Reliability checks

The review compared source policy to CHI-98 and CHI-99 behavior:

- no-work selection;
- Linear claim and re-read;
- lease comment and heartbeat;
- worktree creation;
- safe block;
- human lease release;
- worktree recovery;
- isolated validation;
- commit and push;
- PR creation and base branch;
- Continuum task handoff;
- Linear In Review transition;
- GitHub CI result;
- absence of automatic merge.

Both PRs had green CI at snapshot time.

## Static checks

The pipeline branch's smoke suite passed. It covers shell syntax, config/install modes, dirty-checkout refusal, and dry run. Shell scripts also passed `bash -n` and `git diff --check` during implementation.

This review does not claim automated coverage for the state machine. The absence of those tests is finding PIP-010.

## Artifact validation

The review artifacts are checked for:

- valid JSON;
- valid SVG XML;
- resolving local Markdown links;
- no token-like credential strings;
- no pipeline implementation changes;
- timer remaining disabled.

## Limits

- No malicious prompt was executed against the live worker.
- No destructive Git, Linear, Continuum, Executor, credential, or cloud action was tested.
- Multi-machine claim behavior was analyzed rather than reproduced.
- Cost projection extrapolates one measured no-work session.
- systemd's generic security score includes capability checks that are less meaningful for a user service; the full-home and credential exposure findings were verified separately.
