# Prioritized findings

![Finding map](diagrams/risk-map.svg)

The machine-readable version is [data/findings.json](data/findings.json). P0 means data-loss risk or a false safety claim. P1 should be fixed before merge. P2 is focused follow-up work.

## F-001 P0: replacement canonical database still triggers the removal warning

Evidence:

- `src/db/storage.ts:84-104`
- `src/db/storage-receipt.ts:77-101`
- `data/adversarial-cases.json`, case `canonical-replacement`

The receipt records `destinationFingerprint`, but verification never reads the current destination or checks lineage. It verifies only the source fingerprint and destination existence.

The adversarial case performs a normal migration, deletes the canonical file, creates a valid empty Continuum database at the same path, and runs `summary`. The command exits successfully, does not find the migrated task, and prints:

```text
Legacy database ... matches the exact source state recorded by Continuum and may be removed manually.
```

That warning is false. Deleting the legacy database at this point loses the only copy of the task.

Fix:

1. Add an embedded canonical lineage table or metadata row.
2. Insert the source fingerprint and migration ID into the staged destination before publication.
3. Require that marker before printing the removal warning.
4. Keep the sidecar receipt for audit and human inspection only.
5. Add the adversarial case as a regression test.

Do not compare the current canonical digest to the original destination digest. Legitimate writes must change the database.

## F-002 P1: moving a workspace silently hides its data

Evidence:

- `src/db/paths.ts:30-42`
- `src/workspace/resolve.ts:25-48`
- `data/adversarial-cases.json`, case `workspace-move`

The local project ID is the hash of the normalized absolute workspace path. The adversarial case initializes a workspace, inserts a task, renames the directory, and runs `summary` from the new path.

The command exits successfully with no task. It selects a second XDG path because the path hash changed. The original database remains under the old hash with no discovery path in the product.

Fix:

1. Create `.continuum/workspace.json` with a random stable UUID.
2. Key the XDG project directory by UUID.
3. On upgrade, detect the old path-hash database and adopt it into the UUID directory.
4. Keep a user-level path registry only for diagnostics and aliases.
5. Add rename and symlink tests.

The R2 `projectId` already proves the codebase accepts explicit portable identity. Local storage should use the same idea, while keeping writer identity separate.

## F-003 P1: backups fail after an application version bump

Evidence:

- `src/backup/database-metadata.ts:57-66`
- `src/backup/service.ts:243-254`
- `data/adversarial-cases.json`, case `cross-version-restore`

`inspectSnapshotMetadata` reads `applicationVersion` from the currently running package. Restore compares that value with the historical manifest and requires equality.

The adversarial case changes only the manifest's application version. The SQLite bytes, schema, migration record, checksum, and required tables remain valid. Restore rejects it:

```text
Backup application version 0.0.0 is not supported by 0.1.1
```

Every future version bump has the same result.

Fix:

- Rename the field to `createdByVersion` and treat it as informational.
- Use schema format and Drizzle migration metadata for compatibility.
- Restore into staging, run current additive migrations, rerun integrity checks, then publish the recovery file.
- Preserve the downloaded original artifact for forensic recovery.
- Add a backup-old-version, restore-new-version test.

## F-004 P1: migration crash window cannot recover automatically

Evidence:

- `src/db/storage.ts:128-144`
- `src/db/storage.ts:158-172`
- `data/adversarial-cases.json`, case `crash-after-destination-migrations-before-receipt`

The coordinator publishes the source snapshot, migrates the live destination, and only then writes the receipt. The report simulated a source at migration 0000, stopped at the exact point after destination migration, and reran `continuum init`.

The destination is valid and contains the source state plus additive schema changes. Because no receipt exists and hashes differ, restart reports a divergence conflict and cannot adopt the destination.

Fix:

- Build and migrate a staged database.
- Insert the embedded lineage marker before publication.
- fsync the staged file and destination directory.
- Publish once.
- Make restart adoption inspect the embedded marker.
- Test interruption after every publication step.

The current no-overwrite behavior should remain.

## F-005 P1: storage and backup form a second, non-Effect architecture

Evidence:

- `src/backup/contracts.ts`
- `src/backup/service.ts`
- `src/backup/object-store.ts`
- `src/db/storage-errors.ts`
- `data/metrics.json`

The branch was explicitly refactored around Effect v4, but the newest I/O-heavy code uses another model:

- synchronous orchestration;
- `spawnSync`;
- hand-written unknown dictionaries;
- generic thrown errors;
- ambient date, UUID, HOME, XDG, and process environment;
- no stable CLI error codes for backup outcomes.

The changed backup and storage inventory contains 59 explicit throws. Most represent ordinary expected failures.

Fix the boundary, not every pure function:

```text
backup CLI adapter
  -> Backup application Effect
      requires ObjectStore, Clock, Random, canonical storage
  -> Wrangler object-store Layer
  -> tagged errors rendered by shared CLI boundary
```

Use Effect Schema for backup config, receipt, head, and manifest. Keep key formatting, digest calculation, and pure manifest construction outside services.

## F-006 P2: Config unwraps secrets early and hides malformed files

Evidence:

- `src/memory/config.ts:79-102`
- `src/memory/config.ts:178-185`

The environment migration to Effect Config is useful. It stops test-time environment mutation and reads API keys as Redacted values.

The code unwraps them immediately into a plain `MemoryConfig` string. It also catches every YAML read or parse error and returns the same `null` used for an absent file.

Fix:

- Keep `api_key` as `Redacted.Redacted` through configuration and summary setup.
- Unwrap only when constructing the HTTP authorization value.
- Return a tagged config-file error for unreadable or malformed YAML.
- Default only when the file is absent.

## F-007 P2: real Wrangler and CLI seams are lightly tested

Evidence:

- `src/backup/object-store.ts`: 35.11% line coverage
- `src/cli/commands/backup.ts`: 41.67% line coverage
- `data/coverage-summary.txt`

The in-memory protocol tests are strong. They do not exercise:

- exact Wrangler argv construction;
- environment inheritance and token non-disclosure;
- 404 versus authentication or network failure classification;
- temp-file cleanup on process errors;
- backup CLI JSON envelopes and stable codes.

The manual R2 round trip proves the happy path once. It is not a regression suite.

Use a fake Wrangler executable in tests. It can record argv, copy fixture objects, and emit representative stderr/status pairs without cloud credentials.

## F-008 P2: manual parsing and unused exports add surface

Evidence:

- `src/backup/contracts.ts:75-266`
- `src/db/storage-receipt.ts:69-73`
- anti-slop delta in `data/metrics.json`
- Knip output summarized in `03-effect-and-quality.md`

The branch has 24 more anti-slop diagnostics than master. Fifteen are unsafe unknown dictionaries, four are unknown parameters, and four are runtime type checks. Most come from the manual backup parser.

Five backup symbols are exported without a production caller:

```text
backupConfigPath
BACKUP_FORMAT_VERSION
BACKUP_OBJECT_PREFIX
projectPrefix
generationPrefix
```

Effect Schema removes most parser boilerplate and produces the domain value once. Private helpers should stay private.

## F-009 P2: product docs contain one machine's cloud names

Evidence:

- `docs/R2-BACKUP-DESIGN.md:45`

The committed design names `continuum-snapshots-chicks-arch` and warns against `astro-console-artifacts`. That belongs in an ignored acceptance record, not reusable product documentation.

Use `<dedicated-continuum-bucket>` in docs. Keep the concrete bucket, generation, digest, and test host in local operational evidence.

## F-010 P2: cloud support has no freshness or automation

Evidence:

- `src/cli/commands/backup.ts`
- `docs/R2-BACKUP-DESIGN.md`

The branch implements manual one-way backup. That is a reasonable first protocol and safer than pretending R2 can merge SQLite.

It does not check freshness during normal use, create a timer, expose last successful backup, or warn when local state is newer than head. A user can configure backup once and assume it remains current.

Add:

- `continuum backup status` with local digest, remote head, age, and freshness;
- optional `continuum setup backup-timer` for a user systemd timer;
- a nonzero status for stale or missing backup under an explicit policy.

Do not add automatic backup to every task or memory write. That would make ordinary local operations depend on network availability.

## Inherited debt, not branch regressions

The dependency cycle between `memory/application/query.ts` and `query-recall.ts` exists on master and branch. Exact clone count also remains unchanged. Track those separately rather than hiding branch findings inside a broad cleanup.
