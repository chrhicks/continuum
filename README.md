# Continuum

Continuum gives coding agents durable, workspace-scoped memory. It stores complete observations, decisions, preferences, and lessons so later agents can recover useful context instead of repeating investigation.

MCP is the primary interface. The CLI exposes the same product behavior for scripting, testing, and recovery.

Continuum is intentionally not a task manager, session archive, generated Markdown memory system, summarization pipeline, embedding service, deletion interface, or cross-workspace search service.

## Requirements and installation

Continuum requires [Bun](https://bun.sh/) 1.4 or newer. Git is used when available to identify repositories across clones and worktrees; ordinary non-Git directories are also supported.

```sh
bun install
bun run setup
continuum --help
```

`bun run setup` installs dependencies and links the local `continuum` executable. During development, commands can also be run without a global link:

```sh
bun run continuum --help
```

## MCP

Start the stdio server with:

```sh
continuum mcp
```

A typical MCP client configuration is:

```json
{
  "mcpServers": {
    "continuum": {
      "command": "continuum",
      "args": ["mcp"]
    }
  }
}
```

The server exposes exactly five tools:

| Tool                      | Purpose                                                                        | Key annotations                                                           |
| ------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `continuum_guide`         | Return version-matched usage guidance.                                         | `readOnlyHint: true`, `idempotentHint: true`                              |
| `continuum_summary`       | Return the newest current records and logical workspace metadata.              | `readOnlyHint: false`, `idempotentHint: true`; may register the workspace |
| `continuum_memory_record` | Store one complete immutable record, optionally superseding older records.     | `readOnlyHint: false`, `idempotentHint: false`                            |
| `continuum_memory_search` | Search by ordinary text or browse chronologically with filters and pagination. | `readOnlyHint: true`, `idempotentHint: true`                              |
| `continuum_memory_get`    | Retrieve several exact record IDs and report missing IDs.                      | `readOnlyHint: true`, `idempotentHint: true`                              |

All tools have `destructiveHint: false` and `openWorldHint: false`. Inputs and successful structured outputs have strict schemas. The memory inputs are:

```ts
continuum_summary({ workspace, limit? })
continuum_memory_record({ workspace, content, kind?, tags?, supersedes? })
continuum_memory_search({
  workspace,
  query?,
  tags?,
  kinds?,
  includeHistory?,
  limit?,
  cursor?,
})
continuum_memory_get({ workspace, ids })
```

MCP `workspace` is an absolute existing directory path. Successful calls return their data in `structuredContent`. Application failures set `isError: true` and return a compact safe JSON error envelope in text content; this avoids the pinned MCP SDK validating an error against the tool's success-only output schema. Invalid tool arguments use the MCP SDK's standard validation error result.

### Practical workflow

1. Call `continuum_guide` when orienting to the installed contract.
2. Call `continuum_summary` with the absolute checkout path to recover recent current context.
3. Search for concepts relevant to the work before and during investigation.
4. Record concise, self-contained durable knowledge at useful checkpoints.
5. When knowledge changes, record the replacement with the old IDs in `supersedes`.
6. Browse chronologically when targeted search is insufficient, and use `continuum_memory_get` to follow exact historical references.

## CLI

Successful product commands write one compact JSON value and a newline to stdout. Failures write one safe JSON error envelope to stderr and exit nonzero. Help and version output remain human-readable.

The CLI exposes exactly these commands:

```text
continuum guide
continuum summary [--cwd <path>] [--limit <number>]
continuum record --content <text> [--cwd <path>] [--kind <kind>]
                 [--tag <tag>]... [--supersedes <id>]...
continuum search [--cwd <path>] [--query <text>] [--tag <tag>]...
                 [--kind <kind>]... [--include-history]
                 [--limit <number>] [--cursor <cursor>]
continuum get [--cwd <path>] <ids...>
continuum mcp
```

`--cwd` defaults to the process working directory. Relative values are resolved against that directory. Repeat `--tag`, `--kind`, or `--supersedes` for multiple values.

Examples:

```sh
continuum summary --cwd /work/project

continuum record \
  --cwd /work/project \
  --content 'The cache key includes the schema version.' \
  --kind decision \
  --tag cache \
  --tag schema

continuum search --cwd /work/project --query 'cache schema' --tag cache
continuum search --cwd /work/project --include-history --limit 20
continuum get --cwd /work/project <record-id> <older-record-id>
```

CLI results use the same core shapes as MCP: complete records contain `id`, `kind`, `content`, `tags`, `createdAt`, `supersedes`, and `supersededBy`; paged results contain `records`, `hasMore`, and `nextCursor`; exact retrieval also contains `missingIds`.

## Memory behavior

### Logical workspaces

Every memory operation identifies a workspace by path. Core normalizes the path and resolves it to one logical workspace in a central database.

An already registered path keeps its identity. Otherwise Continuum inspects Git remotes, prefers normalized `origin`, records other remotes as aliases, and falls back to the canonical path when no Git identity exists. Equivalent common SSH and HTTPS remote forms share identity. Re-clones and Git worktrees for the same remote therefore recover the same memory.

Continuum never silently merges or reassigns workspaces when path, descendant, or remote ownership conflicts. It returns a structured `WORKSPACE_ERROR` instead.

### Immutable evidence and supersession

Records retain complete content and are immutable. Omitted kind defaults to `observation`; kinds are open-ended, trimmed, and lowercased. Tags are trimmed, lowercased, deduplicated, and sorted.

`supersedes` may reference only records in the same logical workspace. It adds relationships without rewriting old evidence. Search and summary hide superseded records by default. `includeHistory: true` includes them, and complete records show both `supersedes` and `supersededBy` IDs.

Canonical records, tags, supersession relationships, and FTS updates commit atomically.

### Search, browse, summary, and get

An omitted or whitespace-only search query browses newest records by `createdAt DESC, id DESC`. A nonempty query is treated as ordinary text, escaped from FTS syntax, matched with SQLite FTS5, and ranked with BM25. Tags are weighted as strong retrieval anchors. A nonempty query with no searchable token returns an empty page rather than the unfiltered corpus.

Tag filters require every requested normalized tag. Kind filters accept any requested normalized kind. Superseded history is excluded unless `includeHistory` is true. Search defaults to 20 records and accepts limits from 1 through 100.

`nextCursor` is an opaque, versioned continuation token bound to the logical workspace, retrieval mode, normalized query and filters, history mode, and an internal record anchor. Page size may change between requests. Pagination is deterministic for an unchanged corpus; it is not a snapshot guarantee across concurrent writes, which may change BM25 ranking or current/history status.

`continuum_summary` registers or resolves the workspace and returns workspace identity metadata plus the newest current records. Its default limit is 10. Its cursor continues through an otherwise unfiltered chronological search.

Exact get accepts several IDs, returns complete records regardless of supersession, preserves first-request order after deduplication, and reports unavailable or wrong-workspace IDs in `missingIds`. Search and get do not register a truly unknown workspace; search returns an empty page and get reports its requested IDs missing.

## Storage and failures

Continuum stores one local database at the first applicable location:

```text
$CONTINUUM_DATA_DIR/continuum.db
$XDG_DATA_HOME/continuum/continuum.db
~/.local/share/continuum/continuum.db
```

The data directory and database are user-private on supported platforms. SQLite uses foreign keys, a 5-second busy timeout, WAL journal mode, `synchronous = NORMAL`, short transactions, and numbered migrations tracked with `PRAGMA user_version`. Canonical records remain authoritative; FTS is a rebuildable access path.

Core failures use the small code set `WORKSPACE_ERROR`, `VALIDATION_ERROR`, `DATABASE_ERROR`, and `NOT_FOUND`. They identify the failed operation and include only safe diagnostic context, never record content, SQL, or stack traces in adapter output.

## Legacy v1 importer

`tools/import-v1` is a separate one-time operational utility, not part of the MCP or main CLI surface.

Use a stable, checkpointed copy of the old SQLite database:

```sh
bun run tools/import-v1/src/index.ts \
  --source /safe-copy/legacy.db \
  --workspace /work/project \
  [--data-dir /isolated/continuum-data]
```

The importer opens the source through immutable read-only SQLite, rejects nonempty WAL or rollback-journal sidecars, and rejects hard-linked or target-aliasing source files. It reads only raw journal rows. It preserves IDs and content, preserves canonical timestamps or losslessly normalizes equivalent explicit-timezone timestamps to UTC milliseconds, preserves kind semantics, and normalizes tags through core.

It ignores task data, consolidations and summaries, recall/session data, checkpoints, migration bookkeeping, provenance fields, and generated Markdown files. The entire source is structurally validated before target construction.

Repeated identical imports are idempotent. Reusing an ID for different canonical evidence or another workspace fails without overwrite. Imports are transactional per record rather than for the whole run: a safe prefix may remain after a later collision, and rerunning safely accepts that prefix before retrying the unresolved row.

## Architecture

Continuum is a Bun workspace with explicit dependency direction:

```text
apps/cli ───────→ packages/core
    │
    └───────────→ packages/mcp ───────→ packages/core

tools/import-v1 ──────────────────────→ packages/core
```

- `packages/core` owns workspace identity, records, supersession, retrieval, summary, migrations, and SQLite persistence.
- `packages/mcp` owns strict Zod schemas, MCP tool registration, result mapping, lifecycle, and stdio transport behavior.
- `apps/cli` owns Commander parsing, finite JSON output, direct CLI composition, and the `mcp` command.
- `tools/import-v1` owns the isolated legacy source reader and import command.

The workspace packages are private architectural boundaries, not a published embedding SDK.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, focused test commands, migration guidance, privacy rules, and the full validation workflow. Product and architectural values live in [AGENTS.md](./AGENTS.md); coding defaults live in [CODING_STANDARDS.md](./CODING_STANDARDS.md).

## License

MIT. See [LICENSE](./LICENSE).
