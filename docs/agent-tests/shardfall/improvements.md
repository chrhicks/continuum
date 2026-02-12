# CLI Improvements & Features (from Agent Trials)

Each item includes rationale and evidence links to run summaries/scorecards.

1. Auto-init or hard-gate `task create` before `task init`

- Rationale: Prevent repeated create attempts and DB confusion; shorten first-run path.
- Evidence: `runs/shardfall/SF-01/agent-A/20260210-194532/logs/run-summary.md`, `runs/shardfall/SF-02/agent-A/20260210-200101/logs/run-summary.md`, `runs/shardfall/SF-04/agent-A/20260210-202920/logs/run-summary.md`

2. Add `continuum init` alias or redirect to `task init`

- Rationale: Agents repeatedly tried `--json init` on the root command; provide a safe alias.
- Evidence: `runs/shardfall/SF-01/agent-A/20260210-194532/logs/run-summary.md`, `runs/shardfall/SF-02/agent-A/20260210-200101/logs/run-summary.md`, `runs/shardfall/SF-04/agent-A/20260210-202920/logs/run-summary.md`

3. Add `task step` alias or explicit error with correct `task steps` usage

- Rationale: Repeated confusion over singular vs plural command names.
- Evidence: `runs/shardfall/SF-03/agent-A/20260210-201412/logs/run-summary.md`, `runs/shardfall/SF-03/agent-B/20260210-202431/logs/run-summary.md`, `runs/shardfall/SF-04/agent-B/20260210-204257/logs/run-summary.md`

4. Detect `@-` without stdin and show heredoc example

- Rationale: Agents attempted `@-` without piping content; led to duplicate create attempts.
- Evidence: `runs/shardfall/SF-01/agent-B/20260210-195405/logs/run-summary.md`, `runs/shardfall/SF-03/agent-B/20260210-202431/logs/run-summary.md`

5. `task steps template` + JSON schema validation for steps

- Rationale: Steps were added twice or via ad-hoc files; schema uncertainty caused retries.
- Evidence: `runs/shardfall/SF-02/agent-A/20260210-200101/logs/run-summary.md`, `runs/shardfall/SF-03/agent-A/20260210-201412/logs/run-summary.md`

6. Provide `task init --force` and warn against manual DB edits

- Rationale: Agents copied/edited `.continuum` DB with sqlite to unblock themselves.
- Evidence: `runs/shardfall/SF-01/agent-A/20260210-194532/logs/run-summary.md`, `runs/shardfall/SF-03/agent-A/20260210-201412/logs/run-summary.md`

7. Default note `--source` to `agent` (or prompt)

- Rationale: Notes defaulted to `system`, obscuring attribution.
- Evidence: `runs/shardfall/SF-01/agent-B/20260210-195405/logs/scorecard.md`, `runs/shardfall/SF-02/agent-B/20260210-200933/logs/scorecard.md`

8. Warn on duplicate step completion

- Rationale: Multiple runs completed the same step twice with the same notes.
- Evidence: `runs/shardfall/SF-02/agent-B/20260210-200933/logs/run-summary.md`, `runs/shardfall/SF-03/agent-B/20260210-202431/logs/run-summary.md`

9. Environment readiness check (npm missing)

- Rationale: All runs failed lint/typecheck due to missing npm; CLI should detect and suggest alternatives.
- Evidence: `runs/shardfall/SF-01/agent-A/20260210-194532/logs/scorecard.md`, `runs/shardfall/SF-02/agent-A/20260210-200101/logs/scorecard.md`, `runs/shardfall/SF-03/agent-A/20260210-201412/logs/scorecard.md`, `runs/shardfall/SF-04/agent-A/20260210-202920/logs/scorecard.md`

10. Post-command next-action hints

- Rationale: Frequent `--help` calls suggest unclear discovery path; show next command after create/steps add.
- Evidence: `runs/shardfall/SF-01/agent-A/20260210-194532/logs/run-summary.md`, `runs/shardfall/SF-02/agent-A/20260210-200101/logs/run-summary.md`, `runs/shardfall/SF-04/agent-A/20260210-202920/logs/run-summary.md`

11. Support inline steps/notes without temp files

- Rationale: Agents used `/tmp` files for steps and notes; adds friction and clutter.
- Evidence: `runs/shardfall/SF-04/agent-B/20260210-204257/logs/run-summary.md`
