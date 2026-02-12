# Shardfall CLI Agent Test Plan

## Goal

Evaluate whether agents can use the Continuum CLI effectively while completing real work in
`chrhicks/shardfall`. Focus on task hygiene, command choice, and decision quality.

## Scope

- Repo: https://github.com/chrhicks/shardfall
- Agent type: general
- Scenarios: 4 (see `docs/agent-tests/shardfall/scenarios.md`)
- Effort: medium (less than a day each)

## Success Signals

- Agents use task lifecycle correctly (create -> steps -> notes -> validate -> complete).
- Minimal redundant CLI calls (no list/get loops without need).
- Decisions and discoveries capture useful reasoning.
- Work products match scenario acceptance criteria.

## Non-Interference Strategy

Each run uses its own clone and its own `.continuum` database.

Directory layout (per run):

```
runs/shardfall/<scenario>/<agent>/<run_id>/
  repo/   # git clone of shardfall
  logs/   # terminal + json output
```

This avoids cross-contamination in git state, node_modules, and task DB files.

## Tooling

Use the CLI from this repo, not a global install:

```
bun run /path/to/continuum/bin/continuum --cwd <repo> <command>
```

Always include `--json` for logging.

## Execution Flow (per run)

1. Create a run workspace (see `scripts/agent-tests/setup.sh`).
2. Start terminal capture in the run log directory.
3. Launch the agent with the baseline or variant prompt.
4. Monitor execution, but do not intervene unless blocked.
5. Collect outputs: git diff/status, CLI JSON, and any tests.
6. Score the run using the rubric in `docs/agent-tests/shardfall/scorecard.md`.

## Logging Checklist

Required artifacts per run:

- Terminal transcript (full session).
- CLI JSON outputs.
- `git status` and `git diff`.
- Tests run and results (if any).
- Final task state (`continuum task list --json`).

Suggested terminal capture:

```
script -q logs/terminal.log
```

## Manager Runbook

Use this in order for each run.

1. Setup:

```
./scripts/agent-tests/setup.sh SF-01 agent-A
```

2. Start logging, set environment variables:

```
export CONTINUUM_CLI="/path/to/continuum/bin/continuum"
export REPO_DIR=".../runs/shardfall/SF-01/agent-A/<run_id>/repo"
export LOG_DIR=".../runs/shardfall/SF-01/agent-A/<run_id>/logs"
script -q "$LOG_DIR/terminal.log"
```

3. Launch agent with prompt (baseline or variant).
4. Observe and record any friction.
5. End capture, then gather:

```
git -C "$REPO_DIR" status
git -C "$REPO_DIR" diff
npm --prefix "$REPO_DIR" run lint
npm --prefix "$REPO_DIR" run typecheck
"$CONTINUUM_CLI" --cwd "$REPO_DIR" --json task list
```

6. Score the run and update `run-registry.md`.

## Concurrency Guidance

- Runs can be parallelized as long as they are in separate run directories.
- Do not reuse a clone between runs.
- Use distinct run IDs to prevent log overlap.
