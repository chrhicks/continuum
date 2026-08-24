# Linear-coordinated Scout, Worker, and Reviewer

This kit runs three bounded Pi roles:

```text
Scout (Luna)
  -> prepare one issue or route existing work
Worker (Sol)
  -> implement one ready issue and open a staging PR
Reviewer (Terra)
  -> review and merge to staging, or run one bounded audit
```

Linear coordinates the queue, Continuum records execution context, and GitHub holds source review and integration state. A human promotes the staging branch to `master`.

## Runtime flow

Only the Scout needs a recurring timer. It reports `DISPATCH_WORKER` or `DISPATCH_REVIEWER` when another role should run. The wrapper releases the shared lock and starts that profile through systemd.

All profiles share one lock group, so only one role runs at a time. Every run handles one issue, review, planning action, or bounded audit and then exits.

The control checkout remains clean. Source work occurs in ignored nested worktrees. `bin/validate-continuum-worktree` validates Continuum changes with temporary HOME, XDG, and workspace state rather than touching the durable control ledger.

## Models

| Role | Model | Thinking |
| --- | --- | --- |
| Scout | `openai-codex/gpt-5.6-luna` | medium |
| Worker | `openai-codex/gpt-5.6-sol` | high |
| Reviewer | `openai-codex/gpt-5.6-terra` | high |

The profile files pin these values rather than inheriting Pi defaults.

## Active staging branch

The initial active branch is:

```text
staging/xdg-storage-migration
```

It starts from `feature/xdg-storage-migration`. Worker PRs target staging. The Reviewer may merge passing PRs into staging, but never into `master`. Promotion to `master` remains human-owned.

After promotion, create a fresh staging branch and update all three profiles.

## Continuum runtime contract

Every role fails closed before Pi starts unless the control ledger resolves one
explicit runtime contract:

- the workspace is the absolute `LINEAR_AGENT_REPO` control checkout;
- `LINEAR_AGENT_BUN_BIN` runs that checkout's exact
  `LINEAR_AGENT_CONTINUUM_BIN`;
- `LINEAR_AGENT_CONTINUUM_HOME` and
  `LINEAR_AGENT_CONTINUUM_DATA_HOME` select the canonical XDG storage
  generation and database;
- Pi's MCP config starts the configured `LINEAR_AGENT_EXECUTOR_BIN`; and
- Executor's configured Continuum stdio integration uses that same Bun, CLI,
  checkout, HOME, and XDG data home through the configured no-auth connection.

Inspect Executor's registered server before enabling a profile:

```bash
executor call executor mcp getServer '{"slug":"continuum"}'
executor call executor coreTools connections list '{}'
```

After registering the checkout-backed server, refresh or recreate its no-auth
connection so Executor discovers `continuum_runtime`; a stale connection is
rejected even when the server catalog entry is correct.

The expected stdio command is the absolute Bun path with arguments
`run <control-checkout>/bin/continuum mcp`, `cwd` is the control checkout, and
its explicit environment contains only the configured path contract (including
`HOME` and `XDG_DATA_HOME`; never add credentials to repository config).
`run-once` also invokes the read-only `continuum_runtime` tool through the
configured Executor connection and compares its result with the checkout CLI
diagnostic. It prints the resolved workspace, Bun, CLI, data home, canonical
database, storage generation, integration, and connection, or exits with a
mismatch diagnostic before any agent operation.

`bin/validate-continuum-worktree` is intentionally different: it runs the
source worktree CLI with temporary HOME, XDG data, and workspace directories.
It verifies that the resolved database is below that temporary XDG root before
initialization or validation, so it cannot write the durable control ledger.

## Prerequisites

- Pi with `pi-mcp-adapter`
- Executor MCP exposing Linear and Continuum
- `continuum`, `git`, `gh`, `flock`, `timeout`, and systemd user services
- a dedicated clean control checkout with push access
- the Linear project, statuses, and labels in [COORDINATION.md](COORDINATION.md)

Credentials remain in Pi, gh, SSH, and MCP configuration. Profile files contain identifiers and paths and must remain mode `0600`.

## Install three profiles

From the control checkout:

```bash
ops/linear-agent/bin/install-user --profile=continuum-worker --role=worker
ops/linear-agent/bin/install-user --profile=continuum-reviewer --role=reviewer
ops/linear-agent/bin/install-user --profile=continuum-scout --role=scout
```

Edit and verify:

```text
~/.config/linear-agent/continuum-scout.env
~/.config/linear-agent/continuum-worker.env
~/.config/linear-agent/continuum-reviewer.env
```

The installer preserves existing profile files. Add every runtime-contract
setting from the matching example to an existing profile; preserved profiles
are not migrated automatically. New files start with `LINEAR_AGENT_DRY_RUN=1`.

## Verification

Run each profile in dry-run mode:

```bash
systemctl --user start linear-agent-worker@continuum-scout.service
systemctl --user start linear-agent-worker@continuum-worker.service
systemctl --user start linear-agent-worker@continuum-reviewer.service
journalctl --user -u 'linear-agent-worker@continuum-*' -n 100 --no-pager
```

Then set `LINEAR_AGENT_DRY_RUN=0` in all three files and run the Scout manually. It should route the current queue without overlap.

## Enable polling

Enable only the Scout timer:

```bash
systemctl --user enable --now linear-agent-worker@continuum-scout.timer
systemctl --user disable --now linear-agent-worker@continuum.timer 2>/dev/null || true
```

Worker and Reviewer services are dispatched on demand.

## Operations

```bash
# Current timer and services
systemctl --user list-timers 'linear-agent-worker@*'
systemctl --user status 'linear-agent-worker@continuum-*'

# Run a role manually
systemctl --user start linear-agent-worker@continuum-reviewer.service

# Follow all role logs
journalctl --user -fu 'linear-agent-worker@continuum-*'

# Pause future queue work
systemctl --user disable --now linear-agent-worker@continuum-scout.timer

# Private run artifacts
find ~/.local/state/linear-agent -path '*/runs/*' -type f -ls
```

Repository audits are limited to one bounded area and are considered due once per configured interval. The wrapper records a shared audit marker after `AUDIT_COMPLETE` or `AUDIT_NO_FINDINGS`.
