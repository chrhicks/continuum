# CHI-206: Package and distribution entry-point contract audit

## 1. Verdict

**Primary question:** Does the published package and developer-installation boundary of Continuum accurately and reproducibly expose the supported CLI and SDK entry points from a clean checkout, without relying on repository-only TypeScript/Bun behavior?

**Answer: not yet.** The source-checkout workflow is reproducible, the declared CLI and SDK runtime files are present in a locally packed artifact, external Bun runtime imports work, and ordinary packed CLI commands work. The Bun-only runtime assumption is also explicit. However, the external TypeScript declaration contract fails unless a consumer supplies the repository's Bun ambient types, successful CLI `--help` and `--version` requests exit with status 1, and the README's SDK import has no external-consumer installation or upgrade procedure while the manifest prohibits publication. The package archive also includes 258 mostly non-runtime files, and CI validates source aliases and source execution rather than the packed consumer boundary.

This is a **report-only** inquiry. All five findings below have disposition `report-only`; no follow-up issue was created and no product, package metadata, lockfile, documentation, CI, or cloud resource was changed.

## 2. Baseline, environment, and scope

```text
repository:  https://github.com/chrhicks/continuum
branch:      staging/xdg-storage-migration
commit:      4125fe306eb808b442ad660d00d766baad3c876a
issue:       CHI-206
policy:      report-only
host:        Linux 7.1.5-arch1-2 x86_64
Bun tested:  1.4.2
Node probe:  26.10.0
CI Bun:      1.3.2 (configuration inspected; not locally installed)
```

The audit inspected the complete current `package.json`, `bun.lock`, `bin/continuum`, `src/sdk.d.ts`, `src/sdk/index.ts`, `README.md`, `CONTRIBUTING.md`, `.github/workflows/ci.yml`, `scripts/run-tests-for-validate.ts`, relevant package/SDK configuration and tests, and the CLI exit handling reached through the bin entry point. It exercised:

- installation from a Git-archive-shaped clean checkout;
- the documented `bun run setup` source/link workflow;
- global link registration and linking into a consumer outside the source directory;
- local archive construction and installation into a separate consumer;
- CLI metadata and stateful commands through linked and packed binaries;
- Bun and Node SDK runtime imports;
- external TypeScript declaration resolution with and without repository-only ambient configuration; and
- the repository validation/CI path that is intended to guard these contracts.

The local archive install required registry reads for production dependencies because an isolated empty cache could not resolve package metadata. It used no credentials and performed no publish or release. All other installation checks used the existing local Bun cache with `--offline` where applicable.

## 3. Contract matrix

| Surface                  | Declared/documented contract                                                                                                                                                                                                                                                                                                                                                               | Executed evidence                                                                                                                                                       | Conclusion                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Clean checkout           | Bun is required; `bun run setup` installs dependencies and links `continuum` ([README.md:5-16](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/README.md#L5-L16); [CONTRIBUTING.md:5-19](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/CONTRIBUTING.md#L5-L19)).                                                 | `git archive` checkout, frozen offline install, and `bun run setup` with Bun on `PATH` all exited 0; 161 packages were installed from the lock/cache.                   | Confirmed on Bun 1.4.2.                                                                            |
| Link installation        | `setup` runs `bun link`; manifest exposes a `continuum` bin ([package.json:7-8](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/package.json#L7-L8), [package.json:21-22](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/package.json#L21-L22)).                                                                  | Source registration created the global package/bin links; `bun link continuum-memory-mvp` in a separate consumer created its package and bin links.                     | Mechanism works, but the external-consumer half is undocumented (PKG-002).                         |
| Packed installation      | `bin`, `types`, and root export target source files ([package.json:7-15](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/package.json#L7-L15)).                                                                                                                                                                                                        | `bun pm pack` included all three targets; a local tarball installed into a separate consumer with 108 production packages.                                              | Required files are present; archive boundary is overbroad (PKG-004).                               |
| CLI execution            | `bin/continuum` uses Bun and calls the CLI main ([bin/continuum:1-8](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/bin/continuum#L1-L8)).                                                                                                                                                                                                            | Packed `init` plus JSON `task list` exited 0 in an isolated workspace. Linked and packed `--version` printed `0.1.1` but exited 1; help behaved the same.               | Ordinary execution works; successful metadata commands violate exit-status expectations (PKG-003). |
| SDK runtime              | Root default export is `src/sdk/index.ts`; README requires Bun and imports `continuum-memory-mvp` ([package.json:11-15](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/package.json#L11-L15); [README.md:178-188](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/README.md#L178-L188)).                          | Linked and packed external Bun imports exposed the default SDK and `TASK_TYPES`. Node failed while resolving extensionless TypeScript implementation imports.           | Bun path confirmed; Node failure is expected and not a finding because Bun is explicit.            |
| SDK declarations         | `types` resolves to `src/sdk.d.ts` ([package.json:10-14](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/package.json#L10-L14)).                                                                                                                                                                                                                       | External `tsc --noEmit` passed only with `bun-types` ambient configuration. A normal consumer without it failed in six implementation files on unresolved `bun:sqlite`. | Contract mismatch (PKG-001).                                                                       |
| Registry/public install  | Manifest is `private`; README calls it a private, locally linked package ([package.json:2-5](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/package.json#L2-L5); [README.md:10-16](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/README.md#L10-L16)).                                                           | No publish was attempted. No registry, Git URL, tarball, external link, or upgrade command is documented.                                                               | There is no supported published-package path; the external SDK example is incomplete (PKG-002).    |
| Lock/runtime assumptions | Lock root matches manifest dependencies and pins Effect exactly; CI performs frozen install with Bun 1.3.2 ([bun.lock:1-21](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/bun.lock#L1-L21); [.github/workflows/ci.yml:20-30](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/.github/workflows/ci.yml#L20-L30)). | Frozen clean install succeeded on Bun 1.4.2. The exact CI version was not available locally.                                                                            | Manifest/lock agreement confirmed; cross-version result remains CI-dependent.                      |
| Validation coverage      | CI links source, initializes CLI, and runs `validate` ([.github/workflows/ci.yml:25-34](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/.github/workflows/ci.yml#L25-L34)).                                                                                                                                                                            | Configuration maps test import `continuum` straight to source and supplies `bun-types`; validation invokes `bin/continuum` from source.                                 | It does not exercise the declared package boundary (PKG-005).                                      |

## 4. Prioritized findings

### PKG-001 — P1 — Public declarations require an undeclared consumer ambient type dependency

**Classification:** SDK declaration/type-resolution defect

**Disposition:** `report-only`

The manifest advertises `src/sdk.d.ts` as both top-level `types` and the root export's `types` condition ([package.json:10-14](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/package.json#L10-L14)). That declaration file re-exports public types from `./sdk/types`, but re-exports values and the default SDK directly from the TypeScript implementation `./sdk/index` ([src/sdk.d.ts:1-3](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/src/sdk.d.ts#L1-L3)). Resolving the default export therefore traverses the implementation's task, workspace, and database imports ([src/sdk/index.ts:1-18](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/src/sdk/index.ts#L1-L18)).

In both linked and packed external consumers, this ordinary strict Bundler-resolution check failed despite `skipLibCheck: true`:

```text
node_modules/continuum-memory-mvp/src/db/client.ts(1,26): error TS2307:
Cannot find module 'bun:sqlite' or its corresponding type declarations.
```

The same error arose from six database implementation files. Adding repository-style `types: ["bun-types"]` made the linked check pass, but `bun-types` is a dev dependency, not a package dependency ([package.json:36-41](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/package.json#L36-L41)), and the SDK docs do not tell consumers to install or configure it.

The repository typecheck masks the defect: its global config supplies `bun-types`, and `tests/sdk-contract.ts` imports `continuum` through a path alias directly to `src/sdk/index.ts`, bypassing the package name, export map, and declaration entry point ([tsconfig.json:9-16](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/tsconfig.json#L9-L16); [tests/sdk-contract.ts:1-7](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/tests/sdk-contract.ts#L1-L7)). A Bun runtime consumer can import the SDK, but the advertised declaration contract is not self-sufficient for an external TypeScript consumer.

### PKG-002 — P1 — The documented SDK import has no external-consumer installation or upgrade path

**Classification:** installation/distribution documentation defect

**Disposition:** `report-only`

The README shows `import continuum from 'continuum-memory-mvp'` as the public SDK usage ([README.md:178-188](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/README.md#L178-L188)), but its only installation command is `bun run setup`, immediately described as linking a private package locally as the CLI name `continuum` ([README.md:10-16](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/README.md#L10-L16)). The manifest confirms that registry publication is disabled with `private: true` ([package.json:2-5](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/package.json#L2-L5)). CONTRIBUTING repeats only the source-checkout/global-link flow ([CONTRIBUTING.md:5-19](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/CONTRIBUTING.md#L5-L19)).

The external link mechanism itself works: after running setup in the source checkout, `bun link continuum-memory-mvp` in another project made both the package import and CLI bin available. Bun even printed that consumer command, but neither README nor CONTRIBUTING records it. There is also no documented Git/tarball dependency form, supported version selection, relink/upgrade procedure, or clean uninstall path. Thus a reader outside the repository cannot reproduce the SDK example from the documented contract, and there is no “published package” boundary at all in the current manifest.

This finding does not demand public registry publication. A source-link-only product can be coherent, but its supported external-consumer and upgrade journey must be explicit and must agree with the SDK example.

### PKG-003 — P2 — Successful CLI help and version requests exit with status 1

**Classification:** CLI entry-point exit-status defect

**Disposition:** `report-only`

Both globally linked and packed binaries produced complete help text and printed version `0.1.1`, matching the manifest, but returned exit status 1. Ordinary packed `init` and `task list` returned 0, so this is specific to Commander's successful meta-command flow rather than a broken bin link or missing runtime dependency.

The bin asks `main` to preserve its process exit code ([bin/continuum:4](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/bin/continuum#L4)). The program enables Commander's `exitOverride()` ([src/cli.ts:67](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/src/cli.ts#L67)), then catches every `CommanderError` and unconditionally sets status 1 ([src/cli.ts:20-36](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/src/cli.ts#L20-L36)). Commander represents help/version completion through that error type, so successful display is classified as failure.

Shell installers, command discovery, health checks, editor integrations, and package smoke tests commonly require `--help` or `--version` to exit 0. The executable is reachable and useful, but its metadata-command contract is not automation-safe.

### PKG-004 — P2 — The packed artifact has no runtime allowlist and includes repository operations material

**Classification:** package-content boundary defect

**Disposition:** `report-only`

`package.json` has no `files` allowlist or equivalent package-content boundary ([package.json:1-43](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/package.json#L1-L43)). `bun pm pack --ignore-scripts` produced a 1.23 MB unpacked archive containing 258 files. The required package metadata, README, bin, declaration entry point, SDK implementation, source tree, migrations, and runtime dependencies were present, but so were:

- `.github/workflows/ci.yml`;
- all `ops/linear-agent/` prompts, systemd units, configuration examples, issue templates, scripts, and tests;
- the full `tests/` tree;
- development scripts, plans, roadmaps, and prior review artifacts.

No credential was found or alleged; this is a boundary, bloat, and accidental-disclosure risk, not a secret incident. The archive content follows repository inclusion defaults rather than a deliberate distribution contract. It also makes “what is supported after install” harder to infer because operational and test-only files ship beside runtime files.

### PKG-005 — P2 — CI and validation bypass the package boundary they appear to protect

**Classification:** distribution validation coverage gap

**Disposition:** `report-only`

CI does a frozen source install, runs `bun link`, invokes `continuum init`, and then runs the repository validation gate ([.github/workflows/ci.yml:25-34](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/.github/workflows/ci.yml#L25-L34)). The invariant checker invokes typecheck/tests and isolated commands through `bun run bin/continuum`, again directly from source ([scripts/verify-goal-invariants.ts:409-427](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/scripts/verify-goal-invariants.ts#L409-L427); [scripts/verify-goal-invariants.ts:742-744](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/scripts/verify-goal-invariants.ts#L742-L744)). The SDK contract test uses a source path alias and repository ambient Bun types rather than importing the actual package export map ([tsconfig.json:9-16](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/tsconfig.json#L9-L16)).

Consequently the gate can pass while the external declarations fail, help/version return failure status, and the archive contains unintended files. There is no dry-run pack inventory assertion, packed-artifact install, outside-repository runtime import, outside-repository typecheck, or CLI help/version exit assertion. This is a direct explanation for why PKG-001, PKG-003, and PKG-004 are not caught by the configured package/CI contract.

## 5. Explicit no-finding areas and adjacent observations

1. **Required entry-point files are present.** The packed archive contained `package/package.json`, `package/bin/continuum`, `package/src/sdk.d.ts`, and `package/src/sdk/index.ts`; no missing-file finding applies.
2. **Normal packed CLI execution works.** In an isolated workspace/data home, packed `continuum init` and `continuum --json task list` both exited 0 and returned the expected initialized/empty-list result.
3. **Bun SDK runtime import works outside the repository.** Both linked and packed consumers imported the default SDK and named `TASK_TYPES` successfully.
4. **Bun-only runtime is explicit.** README names Bun as a requirement, the bin uses `#!/usr/bin/env bun`, and the runtime export is TypeScript source. Node 26 failed on implementation resolution, but Node compatibility is not claimed. This is an adjacent runtime observation, not a finding.
5. **Manifest, lock root, and version agree.** Package and CLI report `0.1.1`; lock root dependencies match the manifest, including exact `effect@4.0.0-beta.107` ([bun.lock:1-21](https://github.com/chrhicks/continuum/blob/4125fe306eb808b442ad660d00d766baad3c876a/bun.lock#L1-L21)).
6. **Clean source installation is reproducible with a populated offline cache.** Frozen install succeeded from the tracked lock without changing it. A fully empty machine still requires package registry access, as expected.
7. **Local tarball installation works with dependency registry access.** The archive itself installed and ran. The initial `--offline` packed-consumer attempt could not resolve dependency metadata from an isolated cache; that environment limitation is recorded, not classified as a package defect.
8. **No release was attempted.** `private: true` was assessed from the manifest; no publish, registry write, version bump, or tag operation was performed.

## 6. Coverage ledger

| Requested dimension                | Coverage and disposition                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean checkout installation        | Git-archive checkout, frozen offline install, and exact documented setup command tested; confirmed with stated Bun-version limitation.                                    |
| Package-manager/link installation  | Source registration, global bin creation, separate consumer link, local pack, and separate packed install tested. Missing documented consumer/upgrade journey is PKG-002. |
| CLI execution                      | Bin target, shebang, linked/packed invocation, stateful init/list, help, and version tested. PKG-003 covers the exit-status defect.                                       |
| SDK runtime import                 | Linked and packed Bun imports passed. Node failure is explicitly outside the documented Bun runtime and is recorded as no finding.                                        |
| Declaration/type resolution        | Package export/type declarations tested from linked and packed external consumers with and without Bun ambient types. PKG-001 records the failure.                        |
| External consumer path             | README/CONTRIBUTING and actual Bun link output compared. PKG-002 records the missing documented install/upgrade path.                                                     |
| Declared `bin`                     | Target exists, is archived, links correctly, and runs. Metadata-command semantics fail under PKG-003.                                                                     |
| Declared `exports`                 | Root Bun runtime target resolves from linked and packed consumers. No subpath exports are claimed.                                                                        |
| Declared `types`                   | Target exists but is not consumer-self-sufficient; PKG-001.                                                                                                               |
| Package privacy/publication        | `private: true` confirmed; no registry flow is supported or tested. PKG-002 distinguishes this from the working source-link flow.                                         |
| Runtime assumptions                | Bun requirement, Bun shebang, raw TypeScript export, Node result, and CI/local Bun versions recorded. No unsupported Node requirement was invented.                       |
| Lock consistency                   | Complete lock inspected; frozen clean install passed; exact Effect pin and manifest root agree.                                                                           |
| Archive contents                   | Actual archive inventory, count, size, modes, and required targets inspected. PKG-004 covers over-inclusion.                                                              |
| Installation/upgrade documentation | Install text and SDK example inspected completely. No upgrade/relink/uninstall path exists; PKG-002.                                                                      |
| Validation/CI                      | CI, validation runner, invariant CLI smoke path, tsconfig alias, and SDK contract test inspected. PKG-005 covers bypassed package boundaries.                             |
| Evidence/limitations               | Every finding maps to source and/or executed output. Bun 1.3.2 was not locally executed; packed dependency install required anonymous registry reads.                     |

## 7. Complete disposition ledger

```yaml
policy: report-only
findings:
  - id: PKG-001
    priority: P1
    disposition: report-only
    class: sdk-declaration-type-resolution-defect
  - id: PKG-002
    priority: P1
    disposition: report-only
    class: external-consumer-installation-documentation-defect
  - id: PKG-003
    priority: P2
    disposition: report-only
    class: cli-entry-point-exit-status-defect
  - id: PKG-004
    priority: P2
    disposition: report-only
    class: package-content-boundary-defect
  - id: PKG-005
    priority: P2
    disposition: report-only
    class: distribution-validation-coverage-gap
follow_up_issues_created: 0
product_mutations: 0
```

## 8. Reproduction and result summary

All disposable source, consumer, cache, home, XDG, and workspace directories were created beneath the isolated worktree's `.tmp/` directory and are excluded from the artifact. Representative commands and concise results:

```sh
# Baseline
git rev-parse HEAD
# 4125fe306eb808b442ad660d00d766baad3c876a

bun --version
# 1.4.2

# Clean checkout and documented setup
git archive HEAD | tar -x -C .tmp/clean
bun install --frozen-lockfile --offline --cache-dir "$HOME/.bun/install/cache"
# exit 0; 161 packages installed

PATH="$HOME/.bun/bin:$PATH" BUN_INSTALL="$PWD/.tmp/bun-install" bun run setup
# exit 0; package registered by bun link

# Consumer link
cd .tmp/link-consumer
BUN_INSTALL=".../.tmp/bun-install" bun link continuum-memory-mvp
# exit 0; package and continuum bin linked

# Archive
bun pm pack --destination .tmp/pack --ignore-scripts --quiet
tar -tzf .tmp/pack/continuum-memory-mvp-0.1.1.tgz
# 258 files; 1.23 MB unpacked; required targets plus CI/ops/scripts/tests

# Local archive consumer (anonymous registry reads for dependencies)
bun add ../pack/continuum-memory-mvp-0.1.1.tgz
bun run runtime-probe.ts
# packed-sdk-import-ok:function:5

# External declaration check without repository ambient types
tsc --project tsconfig.json
# exit 2; six TS2307 failures for bun:sqlite reached through implementation source

# CLI metadata
./node_modules/.bin/continuum --version
# prints 0.1.1; exits 1

./node_modules/.bin/continuum --help
# prints complete help; exits 1

# Ordinary packed CLI commands with isolated HOME/XDG_DATA_HOME
./node_modules/.bin/continuum --cwd .tmp/runtime-workspace init
./node_modules/.bin/continuum --cwd .tmp/runtime-workspace --json task list
# both exit 0; list returns { tasks: [] }

# Unsupported runtime boundary
node runtime-probe.ts
# exit 1 while resolving extensionless TypeScript implementation import
```

Final artifact validation passed Prettier, source-link/range checks, `git diff --check`, `bun run validate` (173 tests, 0 failures, invariant result PASS), and the configured isolated Continuum validation helper (173 tests, 0 failures, invariant result PASS). The first validation attempt exposed one transient pre-existing `task-parent-cycles` ordering failure; its focused retry and both complete final gates passed without source or test changes. The durable Continuum record, commit, and PR are recorded in the Linear completion comment.

## 9. Scope and mutation check

- Product source changed: **no**
- Package metadata or lockfile changed: **no**
- README/docs/CI/tests/config changed: **no**
- Follow-up Linear issues created: **no**
- Publish/release/tag/deployment/cloud/credential/billing mutation: **no**
- Inquiry artifact added: **this file only**
- Durable execution context: Continuum task `tkt-pl7p8p5d`
