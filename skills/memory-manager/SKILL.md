# Continuum Memory Manager

Continuum stores canonical memory in `.continuum/continuum.db`. Markdown files are generated, non-authoritative projections.

## Workflow

```bash
continuum summary
continuum memory search "<query>"
continuum memory append agent "<durable context>"
continuum memory consolidate
```

Append only information worth retaining. Journal entries and imported recall messages are immutable evidence; consolidations and recall summaries are derived evidence.

## Recall

```bash
continuum memory recall status
continuum memory recall import --dry-run
continuum memory recall import
continuum memory search "<query>" --source recall
```

Recall is an explicit OpenCode import, never a background synchronization lifecycle.

## Migration

Use `continuum memory migrate --dry-run` before importing historical NOW, RECENT, or MEMORY Markdown. Migration preserves source files and retains the legacy parsers needed to interpret them.

## Core Commands

- `memory append <user|agent|tool> <text...>`
- `memory consolidate [--dry-run]`
- `memory search <query...> [--source memory|recall|all] [--tier NOW|RECENT|MEMORY|all] [--tags ...] [--after ...] [--limit ...]`
- `memory recall status`
- `memory recall import`
- `memory migrate [--dry-run]`
