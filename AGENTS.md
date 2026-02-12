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