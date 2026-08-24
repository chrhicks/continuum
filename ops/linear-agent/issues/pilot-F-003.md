# Permit verified backup restore across application version changes

## Assignment contract

- Repository: `chrhicks/continuum`
- Base branch: `feature/xdg-storage-migration`
- Agent: `effect`
- Suggested labels: `agent:effect`, `repo:continuum`, `risk:backup`, `pilot`

## Intent

A verified R2 snapshot created by an earlier Continuum application version can be restored by a later version when its bytes, identity, schema metadata, migration metadata, and required tables remain compatible.

## Evidence

Review finding F-003 reproduced restore rejection after changing only the historical manifest's application-version label. SQLite bytes, checksum, project and writer identity, schema, migration record, and required tables remained valid.

Current failure:

```text
Backup application version 0.0.0 is not supported by 0.1.1
```

Relevant code:

- `src/backup/database-metadata.ts:57-66`
- `src/backup/service.ts:243-254`
- `tests/backup-service.test.ts`

## Scope

- Remove application package-version equality as a restore compatibility gate.
- Keep the v1 manifest field readable and treat it as creation metadata, preserving existing snapshot compatibility.
- Add a regression test that restores valid bytes when the manifest application version differs from the running package.
- Preserve all existing checksum, size, identity, writer, schema, migration, table, lineage, and no-overwrite checks.

## Out of scope

- Stable workspace identity and migration-lineage repairs from F-001, F-002, and F-004.
- Effect refactoring of backup services.
- R2 cloud mutations or live credential use.
- Manifest format migration unless the regression test proves it is required.
- Automatic PR merge or deployment.

## Acceptance criteria

- [ ] A valid snapshot with a different historical application version restores successfully.
- [ ] Checksum, identity, schema, migration, and required-table mismatches still fail.
- [ ] Existing v1 manifests remain readable.
- [ ] Restore still writes only to a separate no-overwrite recovery path.
- [ ] The regression test fails on branch head `30090c3` before the production change.
- [ ] No unrelated production files change.

## Validation

```bash
bun install --frozen-lockfile
bun test tests/backup-service.test.ts
bun run validate
git diff --check
```

## Safety and rollback

Do not use real R2 credentials or mutate cloud objects. Use the in-memory object store from existing tests. The implementation should be a narrow removal or replacement of the invalid compatibility gate and can be reverted as one commit.

## References

- Full finding: https://github.com/chrhicks/continuum/blob/review/xdg-storage-migration/reviews/xdg-storage-migration/04-findings.md#f-003-p1-backups-fail-after-an-application-version-bump
- Review dashboard: https://github.com/chrhicks/continuum/tree/review/xdg-storage-migration/reviews/xdg-storage-migration
- Machine-readable finding: https://github.com/chrhicks/continuum/blob/review/xdg-storage-migration/reviews/xdg-storage-migration/data/findings.json
- Continuum task: added by the worker after claim
