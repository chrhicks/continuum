# Agent Prompts

Use these prompts verbatim when launching agent runs. Replace `<SCENARIO_ID>` with the
scenario being tested and provide the repo path.

## Baseline Prompt

```
You are working in the Shardfall repo at: <REPO_DIR>

Scenario: <SCENARIO_ID>

Requirements:
- Use the Continuum CLI for all task tracking.
- Use --json on every CLI call.
- Create the task with intent, description, and plan.
- Use steps, add at least one discovery or decision note, validate before completion.
- Run lint + typecheck if you make code changes.

CLI:
  bun run /path/to/continuum/bin/continuum --cwd <REPO_DIR> --json task <command>

Begin.
```

## Variant Prompt (with cheat sheet)

```
You are working in the Shardfall repo at: <REPO_DIR>

Scenario: <SCENARIO_ID>

Requirements:
- Use the Continuum CLI for all task tracking.
- Use --json on every CLI call.
- Create the task with intent, description, and plan.
- Use steps, add at least one discovery or decision note, validate before completion.
- Run lint + typecheck if you make code changes.

CLI (use this for every call):
  bun run /path/to/continuum/bin/continuum --cwd <REPO_DIR> --json <command>

Cheat Sheet:
- Task init: `task init`
- Create: `task create --title ... --type ... --description @- --plan @- --intent "..."`
- Steps: `task steps add <task_id> --steps @steps.json`
- Notes: `task note add <task_id> --kind discovery --content @-`
- Validate: `task validate <task_id> --transition completed`
- Complete: `task complete <task_id> --outcome @-`

Begin.
```
