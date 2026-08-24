# De-slop plan

The branch does not need a rewrite. Most of the code exists for a reason. The cleanup target is the duplicated architecture and the pieces that create work without carrying useful policy.

## What earned its complexity

Keep these parts:

- WAL-aware SQLite serialization;
- integrity checks before publish and restore;
- no-overwrite canonical and restore publication;
- exact source fingerprint checks;
- R2 database, manifest, and head separation;
- download-after-upload verification;
- explicit writer and project IDs;
- stale head detection;
- parent lineage and cycle checks;
- separate-file restore;
- scoped `MemoryRuntime` ownership;
- deterministic XDG test isolation.

Deleting any of these would spread safety checks into callers or remove a real invariant. They are deep behavior, not ceremony.

## What should be deleted or collapsed

### Manual contract parser

`src/backup/contracts.ts` spends most of 266 lines rebuilding schema decoding one field at a time. Replace the decoding half with Effect Schema. Keep only:

- schemas and domain interfaces;
- pure object-key functions;
- JSON encoding if the schema encoder does not make it redundant;
- digest calculation.

This should remove most of the branch's 24 net anti-slop diagnostics.

### Exports with no owner outside the module

Make these private unless a concrete caller appears:

```text
backupConfigPath
BACKUP_FORMAT_VERSION
BACKUP_OBJECT_PREFIX
projectPrefix
generationPrefix
```

Also audit `dbFilePath`, which is now an unused alias for `canonicalDbFilePath`.

### Destination fingerprint as fake proof

The receipt stores `destinationFingerprint`, but later code cannot use an exact digest because the canonical database changes. Do one of two things:

- keep it explicitly as the initial published digest for audit and name it that way; or
- remove it once an embedded lineage marker supplies the real proof.

Do not leave a security-looking field that does no security work.

### Exact application-version gate

Delete the equality check. Keep `createdByVersion` for diagnostics. Migration metadata and staged migration should own compatibility.

### Host-specific documentation

Delete personal bucket names from committed product docs. The acceptance evidence already lives in durable task notes and local cloud state.

### Repeated exception plumbing

Do not create 42 tiny backup error classes. Replace generic throws with a small tagged error algebra and one boundary mapper. Keep pure invariant failures close to the pure code.

## What should be deepened, not split

`backup/service.ts` has three public operations and a set of private lineage functions. At 274 lines it is close to the repository cap, but its behavior is cohesive. Splitting it into arbitrary helper files would make the protocol harder to follow.

Move only technology mechanics and wire decoding out:

```text
backup/contracts.ts       schemas and pure keys
backup/service.ts         create, list, restore policy
backup/object-store.ts    port contract and errors
backup/wrangler-store.ts  process adapter Layer
```

The split follows reasons to change, not line count.

`db/storage.ts` should remain the migration state machine. Put snapshot mechanics in `storage-snapshot.ts` and embedded proof parsing in a focused lineage module. Do not create a generic persistence framework.

## Effect convergence without ceremony

A useful target shape is:

```text
createBackup(workspace)
  Effect<BackupResult,
    BackupConfigError | StorageError | BackupRemoteError |
    BackupIdentityConflict | BackupIntegrityError,
    BackupObjectStore | Clock | Random>
```

The object-store service owns external authority. Its Wrangler Layer owns process execution and environment inheritance. The application operation owns ordering. Pure manifest and key functions stay pure.

Canonical storage can return an Effect with typed errors without becoming a Context service. There is one implementation and no current runtime variation. Add a service only if another implementation or shared acquired resource appears.

## Avoid these tempting tangents

- Do not put every repository back into Context. They are values over an acquired handle.
- Do not add a global dependency registry.
- Do not make ordinary task or memory writes wait for R2.
- Do not claim multi-writer sync without row or event-level merge semantics.
- Do not add a generic workflow engine for a short local migration.
- Do not split files only to satisfy the 300-line check.
- Do not apply every anti-slop warning mechanically. The runtime `typeof` rule is intentionally strict and some SQLite boundary casts need evidence comments, not abstraction.
- Do not migrate unrelated master debt into this branch. The existing query cycle can have its own change.

## Suggested repair sequence

### Commit 1: make migration proof truthful

- Add stable workspace metadata and UUID storage path.
- Add embedded lineage marker.
- Migrate from path-hash storage.
- Fix replacement, move, and crash restart cases.
- Add all three adversarial tests.

### Commit 2: make backup restore durable across releases

- Replace exact app-version equality with schema compatibility.
- Migrate a staged restored database forward.
- Add cross-version tests.

### Commit 3: converge Effect boundaries

- Add backup schemas and tagged errors.
- Add object-store service and Wrangler Layer.
- Use Clock and Random.
- Preserve the current three-operation public behavior.

### Commit 4: test the real adapter and CLI

- Add a fake Wrangler executable.
- Cover argv, environment, failure classification, cleanup, JSON envelopes, and status codes.

### Commit 5: trim surface and docs

- Remove unused exports and alias functions.
- Keep Redacted keys wrapped.
- Type config-file errors.
- Replace host-specific documentation.
- Add backup status and optional timer setup only if that remains in scope.

## Anti-slop as a guardrail

The repository currently has 298 baseline diagnostics under Dillon Mulroy's plugin. Turning every rule on in CI would create a noisy migration unrelated to this branch.

Use a differential check first:

1. Save the master diagnostic set.
2. Fail only on net new diagnostics in changed lines.
3. Fix the backup parser delta.
4. Adopt individual rules globally after the baseline is intentionally cleaned.

This keeps the tool honest. A lint badge that passes through hundreds of suppressions would be worse than no badge.
