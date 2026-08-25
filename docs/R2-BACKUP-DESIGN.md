# Cloudflare R2 snapshots and restore

Continuum implements R2 as **one-way, immutable backup with explicit restore**. It is not synchronization of a live SQLite database, and it does not provide multi-writer merge semantics.

## Safety contract

- The local canonical XDG database is the only live authority.
- Continuum opens it read-only, runs SQLite integrity validation, and uses SQLite serialization to capture a logical WAL-aware snapshot. It never uploads `continuum.db-wal` or `continuum.db-shm`.
- Every database and manifest generation is immutable. Uploads are downloaded and SHA-256 verified before the mutable head is published.
- Before snapshotting, backup creation acquires a fail-fast local lock scoped by the portable project ID and holds it through verified `head.json` publication. Overlap on the same host fails with `BACKUP_CREATION_CONFLICT`; different project IDs use different locks.
- `head.json` is only an inventory entry point. Backup reads it before and after generation upload and refuses to publish a stale head if it changed. Wrangler does not expose conditional object writes, so the local lock and stale-head check do **not** make cross-machine concurrent writers safe.
- Restore downloads to local staging, verifies manifest identity, byte length, SHA-256, SQLite `PRAGMA integrity_check`, migration metadata, and required tables, then atomically publishes a new recovery database.
- Restore never replaces an existing divergent file. Repeating a restore to an identical destination is idempotent; a different destination state is a conflict.

An interrupted generation upload can leave immutable orphan objects. It cannot become the head unless all uploads verify and head publication succeeds. `backup list` walks only the manifest chain reachable from the verified head, so it truthfully excludes incomplete or stale orphan uploads. A missing, corrupt, cyclic, cross-project, or cross-writer head/manifest fails rather than silently selecting another generation.

Normal completion and handled interruption remove the local creation lock. A process kill or host crash can leave `${XDG_DATA_HOME:-$HOME/.local/share}/continuum/backup-locks/<project-id>.lock`. Continuum deliberately does not expire or steal this file based on time: doing so could overlap a slow holder. First confirm that no local `continuum backup create` process for the project remains, then remove only that lock file and rerun `backup create`. The rerun starts with a fresh remote-head read; it never assumes whether the interrupted attempt published, and it never deletes possible orphan objects. Use `backup status` or `backup list` to inspect remote state before rerunning when publication is uncertain.

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

## Backup status and local availability

`continuum backup status` verifies a logical snapshot of the local canonical database, then explicitly reads the remote head and manifest. Its stable `state` values are:

- `missing`: no remote head exists;
- `fresh`: local and remote SHA-256 digests match and the head age is from zero through 86,400 seconds (24 hours), inclusive;
- `stale`: the digests match but the head is older than 24 hours, or its timestamp is in the future because of clock skew;
- `divergent`: the verified local and manifest digests differ; and
- `remote-error`: remote metadata could not be read or verified. Output includes only a stable error code, not provider diagnostics that could contain credentials.

The 24-hour threshold is fixed for deterministic automation and appears as `staleAfterSeconds` in JSON output. Status only reads remote metadata: it does not repair conflicts, publish a head, upload a generation, or download database bytes.

R2 is an optional recovery boundary, not a runtime dependency. Task, memory, summary, and local database commands do not contact R2 and remain usable during an R2, Wrangler, authentication, or network outage. Only explicit `backup status`, `create`, `list`, and `restore` operations can report remote failures.

## Setup and credential boundary

Use a dedicated private R2 bucket that is not shared with unrelated applications.

Wrangler receives authentication only through its child environment. Continuum never opens, parses, logs, or stores the token:

```sh
wrangler r2 bucket create <dedicated-private-bucket>
continuum backup configure --bucket <dedicated-private-bucket>

CLOUDFLARE_API_TOKEN="$(cat "$HOME/.config/continuum/secrets/cloudflare-api-token")" \
  continuum backup create --wrangler /absolute/path/to/wrangler

CLOUDFLARE_API_TOKEN="$(cat "$HOME/.config/continuum/secrets/cloudflare-api-token")" \
  continuum backup status --wrangler /absolute/path/to/wrangler
```

The shell substitution must remain child-scoped and command tracing must be disabled. Never place the token in arguments, the repository, backup configuration, manifests, logs, or generated memory. Use a private token source with mode `0600` and the minimum R2 permissions needed by Wrangler.

## Optional user-systemd timer

Scheduling is opt-in. Ordinary Continuum and backup commands never create, enable, or start a timer. To schedule one daily backup, first replace every `/absolute/path/to/...` placeholder below. Install the environment file with mode `0600`; do not commit it:

```sh
install -d -m 700 "$HOME/.config/continuum"
install -m 600 /dev/null "$HOME/.config/continuum/backup.env"
printf '%s\n' \
  'CLOUDFLARE_API_TOKEN=replace-with-a-minimum-scope-token' \
  'CONTINUUM_WRANGLER=/absolute/path/to/wrangler' \
  > "$HOME/.config/continuum/backup.env"
chmod 600 "$HOME/.config/continuum/backup.env"
```

Create the service and timer. Repeating these writes and the `systemctl` commands is idempotent:

```sh
install -d -m 700 "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/continuum-backup.service" <<'UNIT'
[Unit]
Description=Create a verified immutable Continuum backup
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=%h/.config/continuum/backup.env
ExecStart="/absolute/path/to/continuum" --cwd "/absolute/path/to/workspace" backup create
UNIT

cat > "$HOME/.config/systemd/user/continuum-backup.timer" <<'UNIT'
[Unit]
Description=Create a daily Continuum backup

[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=30m
Unit=continuum-backup.service

[Install]
WantedBy=timers.target
UNIT

chmod 600 "$HOME/.config/systemd/user/continuum-backup.service" \
  "$HOME/.config/systemd/user/continuum-backup.timer"
systemctl --user daemon-reload
systemctl --user enable --now continuum-backup.timer
systemctl --user status continuum-backup.timer
```

`enable --now` is the only enabling step and must be run explicitly. A failed service remains visible through `systemctl --user status continuum-backup.service` and `journalctl --user-unit continuum-backup.service`; Continuum does not hide or retry it.

Uninstall without deleting backup data or project configuration:

```sh
systemctl --user disable --now continuum-backup.timer
rm -f "$HOME/.config/systemd/user/continuum-backup.timer" \
  "$HOME/.config/systemd/user/continuum-backup.service"
systemctl --user daemon-reload
systemctl --user reset-failed continuum-backup.service
```

Delete `$HOME/.config/continuum/backup.env` separately only when its credential is no longer needed. For a dry installation check, set `HOME` to a temporary directory, create the two files twice, compare their checksums, and remove them without running `systemctl`; this cannot enable a real user service.

## Restore drill

Restore defaults to a generation-specific file below the canonical XDG project directory, not to `continuum.db`:

```sh
CLOUDFLARE_API_TOKEN="$(cat "$HOME/.config/continuum/secrets/cloudflare-api-token")" \
  continuum backup restore --generation <generation> \
  --wrangler /absolute/path/to/wrangler
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

R2 snapshots cannot merge SQLite pages or task/memory transactions. Safe future bidirectional sync would require immutable event or row-level semantics, device identities, lineage-aware compare-and-swap heads, and an explicit fork/merge UX. It must never choose a winner from wall-clock time. Until such a protocol exists, only one configured writer may advance a project's R2 head. Continuum prevents overlapping creation for one portable project ID only within a shared local XDG data home; divergent machines remain separate restore candidates under separate portable project IDs and must not create concurrently.
