# Continuum CLI Cheat Sheet (Shardfall Tests)

Use the CLI from this repo and always include `--json`.

```
bun run /path/to/continuum/bin/continuum --cwd <REPO_DIR> --json <command>
```

## Task Lifecycle

```
task init
task create --title "..." --type feature --priority 100 --intent "..." --description @- --plan @-
task steps template
task steps add <task_id> --steps '[{"title":"Investigate failure","description":"Reproduce issue","position":1}]'
task steps add <task_id> --steps @- <<'EOF'
[
  { "title": "Investigate failure", "description": "Reproduce issue", "position": 1 }
]
EOF
task note add <task_id> --kind discovery --content @- <<'EOF'
Captured logs and repro steps.
EOF
task validate <task_id> --transition completed
task complete <task_id> --outcome @-
```

Priority: integer, lower is higher (default 100).

## Task Listing / Graph

```
task list --status ready
task list --status ready --sort priority --order asc
task get <task_id> --expand parent,children,blockers
task graph descendants <task_id>
```

## Step Update

```
task steps update <task_id> <step_id> --status completed --notes @-
task steps complete <task_id> --step-id <step_id> --notes @-
```
