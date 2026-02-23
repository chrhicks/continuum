# Continuum

## Architecture

CLI → SDK → Task Service → Database

Drizzle for ORM/DB

- repository per domain, aka `Task` gets `task.repository.ts` and `task.service.ts`
- DB models are internal and the SDK interface is public (SDK/CLI)

## Testing / Validation

I always want you to run tests and check types

- **Full suite** - `bun test`
- **Smoke-test** - `bun run bin/continuum <command>` (example: `bun run bin/continuum task list --json`)
- **Typecheck** - `bun run typecheck`

## Temporary Files

- When creating temporary files, use a local `.tmp/` directory as you do not have permission to access anything outside the current project directory.

## Searching for Files & Directories

- The `Glob` tool can be unreliable. If you do not see results, use `Bash` and `ls` or `tree` (scoped).

## Introspection of OpenCode sessions

OpenCode stores its data in the user's home directory. Use this location when asked to look back at session data.

OpenCode DB schema (SQLite) for session introspection:

- Core tables: `project`, `session`, `message`, `part`, `session_share`, `permission`, `todo`.
- `project`: `id` (PK), `worktree`, metadata fields, `time_created`, `time_updated`.
- `session`: `id` (PK), `project_id`, `parent_id`, `slug`, `directory`, `title`, `version`, summary stats, `time_created`, `time_updated`, `time_compacting`, `time_archived`.
- `message`: `id` (PK), `session_id`, `time_created`, `time_updated`, `data` (JSON payload).
- `part`: `id` (PK), `message_id`, `session_id`, `time_created`, `time_updated`, `data` (JSON payload).
- Relationships: `session.project_id` -> `project.id`; `message.session_id` -> `session.id`; `part.message_id` -> `message.id` (all cascade delete). `part.session_id` is a direct linkage for session queries.
- Indexes: `session_project_idx`, `session_parent_idx`, `message_session_idx`, `part_message_idx`, `part_session_idx`, `todo_session_idx`.
- No `tool_output` or `usage` tables in this DB.

Answering session questions:

- Resolve repo to project via `project.worktree`.
- Find sessions in `session` by `project_id`, order by `time_created`/`time_updated`.
- Join `message` and `part` via `session_id`/`message_id`; content is inside `data` JSON.

Data directory: `~/.local/share/opencode`
SQLite DB Location: `~/.local/share/opencode/opencode.db`
