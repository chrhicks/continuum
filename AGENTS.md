# Continuum

## Architecture

CLI → SDK → Task Service → Database

Drizzle for ORM/DB
- repository per domain, aka `Task` gets `task.repository.ts` and `task.service.ts`
- DB models are internal and the SDK interface is public (SDK/CLI)