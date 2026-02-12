# Continuum CLI Cheat Sheet (Shardfall Tests)

Use the CLI from this repo and always include `--json`.

```
bun run /path/to/continuum/bin/continuum --cwd <REPO_DIR> --json <command>
```

## Task Lifecycle

```
task init
task create --title "..." --type feature --intent "..." --description @- --plan @-
task steps add <task_id> --steps @steps.json
task note add <task_id> --kind discovery --content @-
task validate <task_id> --transition completed
task complete <task_id> --outcome @-
```

## Task Listing / Graph

```
task list --status ready
task get <task_id> --expand parent,children,blockers
task graph descendants <task_id>
```

## Step Update

```
task steps update <task_id> <step_id> --status completed --notes @-
task steps complete <task_id> --step-id <step_id> --notes @-
```
