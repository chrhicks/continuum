# Cloudflare R2 backup follow-on

This change does not create cloud resources or require credentials. The safe first R2 feature should be **one-way, immutable backup and explicit restore**, not synchronization of a live SQLite database.

## Recommended artifact

1. Open the canonical project database read-only and create a SQLite logical snapshot with the same WAL-aware snapshot boundary used by local migration.
2. Validate `PRAGMA integrity_check` on the snapshot.
3. Upload an immutable object such as `projects/<portable-project-id>/snapshots/<timestamp>-<sha256>.sqlite`.
4. Upload a manifest containing schema/migration version, snapshot SHA-256 and size, creation time, source project identity, tool version, and optional parent snapshot digest.
5. Restore only to a staging file, verify the manifest digest and SQLite integrity, then require an explicit conflict decision before publishing over or beside local canonical state.

Live `continuum.db`, `-wal`, and `-shm` files must never be synchronized independently. Object upload must use conditional creation or content-addressed keys so retries cannot overwrite another snapshot.

## One-way backup versus multi-writer sync

One-way backup has a single authority: the local canonical database. R2 stores immutable recovery points, so concurrent machines can upload separate histories without corrupting SQLite. Retention and restore selection are explicit.

Bidirectional or multi-writer sync is deferred. SQLite page snapshots do not provide row-level merge semantics, and tasks plus memory share transactions. A safe future design needs a portable project ID, writer/device IDs, immutable lineage manifests, compare-and-swap head updates, and an explicit fork/conflict UX. It must never pick a winner based only on timestamps. Until that protocol exists, two divergent heads remain separate restore candidates.

## Identity, encryption, and secrets

The local directory hash is not portable across machines. Cloud backup therefore needs a user-created random portable project ID stored in project-local configuration and in manifests. Linking an existing remote project must be explicit and verify expected identity before upload or restore.

R2 already encrypts at rest, but that does not protect data from bucket credentials or account administrators. Client-side encryption should be an opt-in envelope around the SQLite artifact using an established format/library after dependency review. Keys must come from an OS secret store or an environment/file reference outside the repository; manifests must not contain secrets. Logs must redact account IDs, tokens, and signed URLs.

## Bucket policy and lifecycle

Recommended setup is a private bucket with scoped API credentials limited to the project's prefix. Enable bucket object versioning if available, deny public access, and use lifecycle rules that retain recent snapshots densely and older snapshots sparsely. Manifests and at least one known-good snapshot should outlive automated expiration. Deletion and legal-retention behavior need documented recovery windows.

## Restore verification

A restore command should download to staging, verify object size and SHA-256, decrypt if configured, run SQLite integrity validation, inspect schema compatibility, and compare local/remote lineage. It should default to writing a separate recovery database. Replacing canonical state requires an explicit backup of current state and user confirmation; legacy or current databases are never silently deleted.

## Required user setup

A future implementation will need:

- R2 account ID, private bucket name, endpoint/region details, and scoped access key/secret supplied outside the repository;
- an explicit portable project ID/link action;
- retention/lifecycle choices;
- optional client-side encryption key configuration;
- a successful upload plus download-and-verify drill before backup is reported healthy.

Credential-independent implementation can start with local snapshot/manifest creation and restore verification tests. Network upload, remote-head coordination, and credential handling should be separate reviewed changes.
