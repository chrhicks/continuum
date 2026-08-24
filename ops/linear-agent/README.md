# Linear-coordinated agent worker

This kit runs one bounded OpenCode issue per invocation. Linear coordinates assignment, Continuum records execution context, and GitHub owns review and merge.

Read [the coordination contract](COORDINATION.md) before enabling the timer.

## Design

```text
systemd timer
  -> run-once lock and preflight
  -> OpenCode agent `effect`
  -> Linear MCP: select, claim, heartbeat, handoff
  -> Continuum: task, plan, discoveries, outcome
  -> ignored Git worktree: edit, test, commit, push
  -> GitHub PR, never merge
  -> process exits
```

The wrapper defaults to dry-run mode, rejects group-readable configuration, refuses dirty control checkouts, allows one process per profile, and stops the agent after a configured timeout.

## Prerequisites

- OpenCode with an `effect` agent
- Linear MCP available to that agent
- `continuum`, `git`, `gh`, `flock`, and `timeout`
- A dedicated clean checkout with push access
- The Linear project, stock team statuses, and routing labels from [the contract](COORDINATION.md)

Store Linear credentials in the MCP configuration or its secret store. Do not put tokens in the worker environment file.

## Dedicated checkout

Do not use a human checkout. On `chicks-arch`, the existing `/home/chicks/workspaces/opencode/continuum` tree contains unrelated uncommitted recall work and is not eligible.

Create a control checkout after this branch is pushed:

```bash
mkdir -p ~/workspaces/agents
git clone --branch ops/linear-agent-worker \
  git@github.com:chrhicks/continuum.git \
  ~/workspaces/agents/continuum-control
```

The worker creates nested ignored worktrees under `.linear-agent-worktrees/`. It runs Continuum against the stable control checkout so disposable code worktrees do not fragment the execution ledger.

## Install without enabling

From the control checkout:

```bash
ops/linear-agent/bin/install-user
$EDITOR ~/.config/linear-agent/continuum.env
chmod 600 ~/.config/linear-agent/continuum.env
```

The installer copies the wrapper, prompts, and systemd templates into user directories. It does not enable the timer unless passed `--enable`.

The example configuration starts with:

```text
LINEAR_AGENT_DRY_RUN=1
```

Keep it enabled until paths, stock status names, project, assignee, routing label, allowed branches, OpenCode agent, and MCP access are verified.

## Dry run

```bash
systemctl --user start linear-agent-worker@continuum.service
journalctl --user -u linear-agent-worker@continuum.service -n 100 --no-pager
```

The dry run validates the control checkout and renders the exact worker prompt without calling OpenCode.

Verify Linear MCP separately with a read-only agent request. It should list the configured project without changing any issue.

## Pilot

The initial coordination objects are provisioned:

- Project: [Continuum XDG Storage and R2 Hardening](https://linear.app/chicks/project/continuum-xdg-storage-and-r2-hardening-b2f0659517a5)
- Backlog issue: [CHI-98](https://linear.app/chicks/issue/CHI-98/permit-verified-backup-restore-across-application-version-changes)

The issue remains in Backlog until the worker passes a no-work run.

1. Verify the Linear project and routing labels. Keep the team's stock statuses.
2. Verify CHI-98 against [the F-003 pilot issue](issues/pilot-F-003.md).
3. Leave CHI-98 in Backlog while testing MCP; Todo is the ready queue.
4. Set `LINEAR_AGENT_DRY_RUN=0`.
5. Run the service once with no eligible issue. Confirm it reports `NO_WORK` and changes nothing.
6. Move F-003 to Todo and run the service manually again.
7. Inspect the Linear lease, Continuum task, worktree, validation, branch, and PR.
8. Enable polling only after the manual pilot behaves correctly.

```bash
systemctl --user enable --now linear-agent-worker@continuum.timer
systemctl --user list-timers 'linear-agent-worker@*'
```

## Operations

```bash
# Run one bounded iteration
systemctl --user start linear-agent-worker@continuum.service

# Follow logs
journalctl --user -fu linear-agent-worker@continuum.service

# Stop future polling without interrupting manual Git work
systemctl --user disable --now linear-agent-worker@continuum.timer

# Inspect private run logs and rendered prompts
find ~/.local/state/linear-agent/continuum/runs -maxdepth 1 -type f -ls
```

The timer waits five minutes after a run finishes, so it cannot overlap its own service. The wrapper also uses `flock` in case a manual run races the timer.

## Scout mode

`prompts/scout.md` is proposal-only. Do not schedule it during the pilot. After several accepted worker PRs, add a separate low-frequency profile that can create backlog proposals but cannot apply the routing label or move them to Todo.

## Known limitation

Linear status updates are not compare-and-swap operations. A claim is status update, lease comment, and re-read. Run only one active worker for an assignee during the pilot. Multi-machine dispatch needs a stronger external lease before expansion.
