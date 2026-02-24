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
- Create the task with intent, description, plan, and an explicit priority (lower = higher priority).
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
- Create the task with intent, description, plan, and an explicit priority (lower = higher priority).
- Use steps, add at least one discovery or decision note, validate before completion.
- Run lint + typecheck if you make code changes.

CLI (use this for every call):
  bun run /path/to/continuum/bin/continuum --cwd <REPO_DIR> --json <command>

Cheat Sheet:
- Task init: `task init`
- Create: `task create --title ... --type ... --priority 100 --description @- --plan @- --intent "..."`
- Steps (inline JSON): `task steps add <task_id> --steps '[{"title":"...","description":"...","position":1}]'`
- Notes: `task note add <task_id> --kind discovery --content @-`
- Validate: `task validate <task_id> --transition completed`
- Complete: `task complete <task_id> --outcome @-`

Heredoc examples:
```

task steps add <task_id> --steps @- <<'EOF'
[
{ "title": "...", "description": "...", "position": 1 }
]
EOF
task note add <task_id> --kind discovery --content @- <<'EOF'
...
EOF

```

Begin.
```
