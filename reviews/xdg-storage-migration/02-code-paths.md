# Code paths and decision map

This file describes every changed caller-visible path. The generated inventories cover the lower-level branches:

- [565 decision points](data/decision-points.csv), including conditions, switch cases, loops, catches, and short-circuit paths
- [252 changed-source functions](data/function-inventory.csv), including parameters, return annotations, size, decisions, throws, catches, and loops
- [Syntactic call edges](data/call-edges.csv)

The generated inventory is deliberately mechanical. The tables below add meaning: inputs, outputs, authority, and failure behavior.

## Entrypoint and workspace resolution

| Step | Input | Decision | Output or side effect |
| --- | --- | --- | --- |
| Global CLI parse | process argv | `--cwd` present? | process working directory changes before command action |
| Workspace root search | requested path or cwd | nearest `.continuum` or `.git` marker? | marker directory, or original start directory at filesystem root |
| Path normalization | workspace root | `realpath` succeeds? | native realpath, otherwise absolute path |
| Canonical data home | options and environment | explicit option, then XDG_DATA_HOME, then HOME | user data root |
| Canonical project path | normalized root | none | SHA-256 path ID and XDG database path |
| OpenCode path | XDG_DATA_HOME or home | XDG set? | OpenCode SQLite path |

The fallback to the invocation directory matters. A fresh non-git directory has no durable root marker until `continuum init` creates `.continuum`.

## `continuum init`

```text
argv
 -> Commander init action
 -> SDK task.init
 -> resolve workspace root
 -> init_status(canonical DB exists?, .continuum exists?)
 -> init_project
    -> create .continuum marker if absent
    -> prepareCanonicalDatabase(initialize=true)
 -> init_status
 -> human or JSON rendering
```

Inputs:

- current or requested workspace;
- HOME and XDG_DATA_HOME;
- optional legacy `.continuum/continuum.db`;
- optional canonical DB and receipt.

Outputs:

- `.continuum/` marker;
- fresh or migrated XDG SQLite database;
- migration receipt when legacy input exists;
- status fields `created`, `initialized`, `pluginDirExists`, and `dbFileExists`;
- a legacy-removal warning only on a proven path.

Material branches are shown in [the storage decision tree](diagrams/storage-migration-flow.svg). The full storage branch table is below.

| State | initialize | Result |
| --- | --- | --- |
| no legacy, no destination | false | return absent state; a later DB client may still create the DB |
| no legacy, no destination | true | create and migrate fresh XDG DB |
| no legacy, destination exists | either | return existing state |
| legacy, valid receipt, destination exists | either | verify source fingerprint, warn, return destination |
| legacy, valid receipt, destination missing | either | fail |
| legacy, no receipt, equivalent destination | either | adopt, record receipt, warn |
| legacy, no receipt, divergent destination | either | conflict, preserve both |
| legacy, no receipt, no destination | false | fail and request `continuum init` |
| legacy, no receipt, no destination | true | snapshot, migrate, receipt, warn |
| legacy changes during migration | true | conflict, no receipt |

The first unsafe state is not represented: receipt exists, destination exists, but destination is unrelated. That state currently warns.

## Standard task operations

```text
CLI task command or SDK method
 -> resolve workspace root
 -> task service
 -> getDbClient(workspace)
    -> prepareCanonicalDatabase(initialize=false)
    -> canonicalDbFilePath
    -> cached Drizzle and bun:sqlite handle
 -> task repository
 -> result mapper and renderer
```

Inputs are task IDs, create/update fields, list filters, steps, and notes. Outputs are SDK task models or CLI/MCP envelopes. Writes go only to the XDG database after migration.

Decision points retained from master include status transitions, blocker checks, collection patch semantics, pagination cursors, and duplicate step completion. The branch mostly removes non-null assertions from these paths.

## Memory CLI path

```text
memory subcommand
 -> preAction installs WorkspaceContext
 -> runMemoryCommand
    -> prepareCanonicalDatabase
    -> memoryRuntimeLayer(config)
       -> createClient
       -> runMigrations
       -> acquireRelease closes SQLite handle
    -> application Effect
    -> Effect.result
 -> shared CLI error renderer
 -> postAction restores prior context
```

Memory append:

1. Decode append input through `JournalAppendInput`.
2. Insert or return the idempotent journal row.
3. Acquire projection publication lock.
4. Regenerate `NOW.md`.
5. Return saved entry and either fresh or stale projection status.

Memory consolidate:

1. Read latest completed boundary and current maximum sequence.
2. List pending entries in that stable range.
3. Return `no-pending` when empty.
4. Load file and environment configuration.
5. Summarize outside a write transaction.
6. Return preview for dry run.
7. Persist exact range, or return conflict if another completion advanced the boundary.
8. Regenerate projections.
9. Return completed result and projection status.

Recall import:

1. Resolve workspace, source DB, and memory config.
2. Extract OpenCode sessions.
3. Filter by date and limit.
4. Normalize user and assistant messages.
5. Compare fingerprints.
6. Skip unchanged sessions.
7. Summarize changed sessions when configured.
8. Replace source, messages, and summary atomically through the repository.
9. Return imported, skipped, and failed counts.

## MCP path

```text
absolute workspace argument
 -> resolveMcpWorkspace
    -> absolute and directory checks
    -> workspace resolver
    -> prepareCanonicalDatabase
    -> canonical DB existence check
 -> operation-specific repository values
 -> application Effect or task service
 -> structured MCP result
```

MCP does not acquire `MemoryRuntime`. It opens or retrieves a cached handle and passes repository values directly. This is a valid value boundary, but it is a second composition path that must stay aligned with the CLI runtime.

## Backup configure

| Input | Decision | Output |
| --- | --- | --- |
| workspace and bucket | bucket syntax valid? | error or continue |
| optional project and writer UUIDs | config file exists? | parse existing or create new IDs |
| existing config | bucket differs? | conflict |
| existing config | explicit project or writer differs? | conflict |
| absent config | none | mode-0600 staged file renamed to `.continuum/r2-backup.json` |

The config contains identity and bucket name, not credentials.

## Backup create

![Backup paths](diagrams/backup-protocol.svg)

Inputs:

- resolved workspace;
- project-local backup config;
- canonical SQLite database;
- object store adapter;
- current date and random UUID;
- Wrangler child environment.

Path:

1. Prepare canonical storage.
2. Serialize and hash an integrity-checked database snapshot.
3. Read `head.json`.
4. If head exists, parse it and require matching project ID, writer ID, and manifest key.
5. Build a generation ID from timestamp and UUID.
6. Inspect migration and table metadata.
7. Build database and manifest object keys.
8. For each immutable object:
   - get existing object;
   - if identical, accept idempotent retry;
   - if different, fail conflict;
   - if absent, upload, download, and compare digest.
9. Read head again.
10. If generation changed, fail stale and leave orphan generation objects.
11. Put mutable head.
12. Download head and compare digest.
13. Return generation, digest, bytes, and parent.

Observable failures include configuration, canonical storage, SQLite integrity, object download/upload, immutable collision, writer conflict, stale head, and post-upload verification. All currently surface as generic exceptions.

## Backup list

Inputs are workspace, object store, and a limit.

Branches:

- limit outside 1 through 1000: fail;
- no head: return empty list;
- invalid head identity, writer, or manifest key: fail;
- repeated generation: cycle failure;
- missing or invalid manifest: fail;
- parent null: complete;
- limit reached: return prefix of reachable lineage.

Output is newest-first manifest history reachable from head. Orphan objects are intentionally invisible.

## Backup restore

Inputs are workspace, object store, optional generation, and optional output path.

Path:

1. Use explicit generation or require head.
2. Validate generation syntax.
3. Read and verify manifest identity, writer, and database key.
4. Download database bytes.
5. Verify size and SHA-256.
6. Write bytes to a private temporary SQLite file.
7. Run integrity check, read migration metadata, and list tables.
8. Compare manifest metadata to current inspection.
9. Resolve output path under XDG restores or use explicit path.
10. Write and fsync a staging file.
11. Validate staging by reopening SQLite.
12. Hard-link staging into an absent destination.
13. If destination exists, accept only byte-identical content.
14. Return generation, digest, bytes, and output path.

The exact application-version comparison at step 8 rejects historical backups after a release bump.

## Wrangler object-store adapter

Get:

```text
key -> private temp directory -> wrangler r2 object get --remote
 -> status 0: bytes
 -> stderr resembles missing object: null
 -> other status: Error with captured stderr or stdout
 -> cleanup temp directory
```

Put:

```text
key + bytes + content type
 -> private temp file, mode 0600
 -> wrangler r2 object put --remote
 -> nonzero: Error
 -> cleanup temp directory
```

The adapter receives the entire child environment. Continuum does not parse the token. `spawnSync` blocks the process until Wrangler exits.

## Configuration path

Environment input is decoded with Effect `Config`:

- four API key candidates as Redacted values;
- summary and consolidation models;
- summary API URL.

The code immediately unwraps the keys into plain strings. It then reads YAML synchronously. Missing, unreadable, malformed, or non-object YAML all become `null`, which falls back to defaults and environment values.

File values take precedence over environment values. The selected API key order is Zen, summary, consolidation, then OpenAI. A key without a model receives the built-in model. No key means consolidation is disabled.

## Error output

The shared CLI renderer distinguishes:

1. `ContinuumError` with code and suggestions;
2. `CanonicalStorageError` with migration code;
3. objects with `_tag`, rendered as uppercase snake case;
4. every other value as `UNKNOWN_ERROR`.

Backup failures take path 4. JSON output therefore loses the failure category even when the message is useful.

## Side-effect inventory

| Side effect | Owner | Transaction or publication boundary |
| --- | --- | --- |
| canonical DB creation | storage coordinator | SQLite migrations |
| legacy snapshot | snapshot module | read-only SQLite serialization |
| canonical publish | snapshot module | fsync file, hard link, no overwrite |
| receipt publish | receipt module | fsync file, hard link, no overwrite |
| task and memory writes | repositories | short SQLite transactions |
| Markdown projections | memory projection modules | atomic file replacement |
| backup config | backup config | mode-0600 staging rename |
| R2 object writes | Wrangler adapter | remote put followed by get and hash |
| restore publish | snapshot module | separate path, no overwrite |
| warnings and CLI output | CLI/storage boundary | stderr or stdout |

## Exhaustiveness note

The CSV and JSON decision inventories are generated from every changed TypeScript source file. They include old functions touched by the Effect and assertion cleanup, not only newly added files. They are syntactic maps, so a compound boolean appears as the outer branch plus its short-circuit decisions. They do not claim dynamic path coverage. Coverage evidence is reported separately.
