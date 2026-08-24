# Cloudflare R2 snapshots and restore

Continuum implements R2 as **one-way, immutable backup with explicit restore**. It is not synchronization of a live SQLite database, and it does not provide multi-writer merge semantics.

## Safety contract

- The local canonical XDG database is the only live authority.
- Continuum opens it read-only, runs SQLite integrity validation, and uses SQLite serialization to capture a logical WAL-aware snapshot. It never uploads `continuum.db-wal` or `continuum.db-shm`.
- Every database and manifest generation is immutable. Uploads are downloaded and SHA-256 verified before the mutable head is published.
- `head.json` is only an inventory entry point. Backup reads it before and after generation upload and refuses to publish a stale head if it changed. Wrangler does not expose conditional object writes, so this detection does **not** make concurrent writers safe.
- Restore downloads to local staging, verifies manifest identity, byte length, SHA-256, SQLite `PRAGMA integrity_check`, migration metadata, and required tables, then atomically publishes a new recovery database.
- Restore never replaces an existing divergent file. Repeating a restore to an identical destination is idempotent; a different destination state is a conflict.

An interrupted generation upload can leave immutable orphan objects. It cannot become the head unless all uploads verify and head publication succeeds. `backup list` walks only the manifest chain reachable from the verified head, so it truthfully excludes incomplete or stale orphan uploads. A missing, corrupt, cyclic, cross-project, or cross-writer head/manifest fails rather than silently selecting another generation.

## Portable identity and writer contract

`continuum backup configure` creates `.continuum/r2-backup.json` with:

- a random portable `projectId` used in every remote key and manifest;
- a random `writerId` enforcing the configured single writer;
- the dedicated private bucket name; and
- configuration format and creation time.

The local path hash used for XDG storage is deliberately not reused: absolute paths differ across machines. To recover or deliberately move the writer role, configure another checkout with the explicit `--project-id` and `--writer-id` values from the original configuration. Stop backups on the original machine before doing this. Supplying only the project ID with a new writer ID produces a visible writer conflict; Continuum has no implicit takeover.

The IDs are identities, not credentials. The configuration contains no Cloudflare token. It is under the already ignored `.continuum/` directory and should be copied deliberately, not committed accidentally.

## Object layout and manifests

All keys are scoped under the format version and portable project ID:

```text
continuum/v1/projects/<project-id>/head.json
continuum/v1/projects/<project-id>/generations/<timestamp>-<uuid>/manifest.json
continuum/v1/projects/<project-id>/generations/<timestamp>-<uuid>/continuum.sqlite
```

A generation manifest records format version, project and writer IDs, generation and parent generation, creation time, database object key, SHA-256 and size, Continuum application version, latest Drizzle migration hash/time, and sorted SQLite table inventory. A head records the current generation and exact manifest key. History is an immutable parent chain; timestamps are labels and are never used to resolve conflicts.

Generation object keys are never intentionally overwritten. Because Wrangler's object command has no conditional-create option, Continuum first checks for an existing object, accepts only byte-identical retry content, uploads, and downloads to verify. Random generation IDs make an accidental collision negligible; a non-identical collision is fatal.

## Setup and credential boundary

Use a dedicated private R2 bucket. The chicks-arch acceptance bucket is `continuum-snapshots-chicks-arch`; `astro-console-artifacts` is unrelated and must not be used.

Wrangler receives authentication only through its child environment. Continuum never opens, parses, logs, or stores the token:

```sh
wrangler r2 bucket create <dedicated-bucket>
continuum backup configure --bucket <dedicated-bucket>

CLOUDFLARE_API_TOKEN="$(cat "$HOME/.config/continuum/secrets/cloudflare-api-token")" \
  continuum backup create --wrangler /home/chicks/.local/bin/wrangler

CLOUDFLARE_API_TOKEN="$(cat "$HOME/.config/continuum/secrets/cloudflare-api-token")" \
  continuum backup list --wrangler /home/chicks/.local/bin/wrangler
```

The shell substitution must remain child-scoped and command tracing must be disabled. Never place the token in arguments, the repository, backup configuration, manifests, logs, or generated memory. For other installations, use a private token source with mode `0600` and the minimum R2 permissions needed by Wrangler.

## Restore drill

Restore defaults to a generation-specific file below the canonical XDG project directory, not to `continuum.db`:

```sh
CLOUDFLARE_API_TOKEN="$(cat "$HOME/.config/continuum/secrets/cloudflare-api-token")" \
  continuum backup restore --generation <generation> \
  --wrangler /home/chicks/.local/bin/wrangler
```

Use `--output <new-path>` for an isolated drill. The output must be absent or byte-identical. Inspect the recovered database before promotion. Continuum intentionally has no in-place replacement flag: promoting recovery state requires stopping all Continuum processes, preserving the current canonical database as another verified recovery point, and making an explicit operator decision. This prevents a remote snapshot from silently overwriting newer or divergent local state.

## Retention and recovery

Keep the bucket private and public development URLs disabled. Retention must preserve:

1. `head.json`;
2. every manifest retained in the reachable parent chain; and
3. each retained manifest's `continuum.sqlite` object.

A blanket lifecycle rule that expires generation objects independently can corrupt inventory and restore history. Prefer an explicit future prune command that rewrites retained lineage safely; no automated remote deletion is implemented now. Until then, retain all generations or manually delete only known orphan generations after confirming they are not referenced from the head chain.

Run an upload/list/restore/checksum drill after initial setup and periodically thereafter. A successful upload alone is not a recovery test.

## Deferred bidirectional sync

R2 snapshots cannot merge SQLite pages or task/memory transactions. Safe future bidirectional sync would require immutable event or row-level semantics, device identities, lineage-aware compare-and-swap heads, and an explicit fork/merge UX. It must never choose a winner from wall-clock time. Until such a protocol exists, only one configured writer may advance a project's R2 head; divergent machines remain separate restore candidates under separate portable project IDs.
