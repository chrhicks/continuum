# Continuum Coding Standards

These are Continuum's coding defaults and preferences. They describe the qualities we want the code to have rather than a set of invariants to satisfy mechanically. Apply them with judgment. When a preference obscures the concrete behavior or conflicts with a real constraint, discuss the tradeoff instead of working around the document.

Product and architectural intent lives in [AGENTS.md](./AGENTS.md). Setup and current commands belong in [CONTRIBUTING.md](./CONTRIBUTING.md).

## Readability

Code is the primary explanation of how Continuum works. A mid-level TypeScript engineer should be able to follow an ordinary operation through a small number of clearly named files.

- Keep the successful critical path explicit.
- Name modules and values after the behavior or concept they own.
- Prefer ordinary language and direct control flow over framework vocabulary.
- Keep functions and files cohesive enough to understand locally.
- Split code when the resulting pieces have independently meaningful responsibilities, not to satisfy a size target.
- Do not compress code merely to make it shorter.

If understanding a feature requires repeatedly tracing forwarding functions, generic wrappers, or re-export chains, reconsider the shape of the code before documenting around it.

## Features and packages

Organize implementation around recognizable features inside packages with deliberate responsibilities.

- Keep core memory behavior in `packages/core`.
- Keep MCP schemas and transport behavior in `packages/mcp`.
- Keep command parsing and executable composition in `apps/cli`.
- Expose a narrow public entry point from each package.
- Import through another package's public exports rather than reaching into its source tree.
- Keep construction visible at the executable composition point.

A directory is useful when it groups a coherent area that a developer would naturally browse. A package is useful when it enforces a real interface and dependency direction. Neither is valuable merely because a conventional architecture diagram contains it.

Avoid generic `shared`, `common`, `helpers`, or `utils` areas that become homes for unrelated code. Small feature-local support functions are often easier to discover. When behavior is genuinely shared, name the common concept it represents.

## Abstraction and duplication

Prefer the simplest implementation that explains today's behavior.

An abstraction earns its place when it:

- names a stable concept
- removes meaningful duplication without hiding differences
- protects a package or external-system boundary
- makes the calling code easier to understand

A little local duplication can be cheaper than a premature abstraction based on imagined variation. Conversely, repeated behavior that changes for the same reason should have one clear owner.

Avoid service containers, ambient dependency bags, generic repository frameworks, plugin registries, and provider matrices without a concrete need. Passing an explicit database or application object is usually easier to understand than constructing a framework around dependency access.

## Types and validation

Types should clarify values and states that matter to the product.

- Infer obvious local types.
- Name public contracts and important domain values.
- Prefer small object shapes and discriminated states over boolean combinations.
- Keep type-level machinery simpler than the runtime behavior it protects.
- Validate untrusted input at MCP, CLI, filesystem, and migration boundaries.
- Normalize external values before they enter core workflows.
- Keep transport schemas at the transport boundary rather than making all core code speak in schema-library types.

Zod is appropriate at MCP and CLI input boundaries. Core should generally use plain TypeScript values after validation, while still protecting invariants that only core can know, such as workspace ownership of superseded records.

## Data and persistence

SQLite is canonical. Memory records are immutable evidence; supersession adds a relationship rather than rewriting prior content.

- Keep writes atomic and fail the operation when canonical persistence fails.
- Do not introduce best-effort secondary projections that create partial-success states.
- Keep SQL close to the feature behavior it implements and format nontrivial queries for readability.
- Use small numbered SQL migrations so schema evolution remains visible.
- Treat FTS indexes and other derived indexes as rebuildable access paths, not canonical memory.
- Preserve complete records in retrieval results unless a caller explicitly asks for less.

The central database contains multiple isolated workspaces. Workspace resolution should remain explicit in public operations even though checkout paths and Git remotes are normalized internally.

## Errors and output

Failures should identify what operation failed and provide safe context that helps diagnose it.

- Use a small set of plain, structured error codes.
- Preserve the meaningful underlying cause without exposing memory content unnecessarily.
- Do not swallow database, workspace, or retrieval failures.
- Do not report a write as successful until its transaction commits.
- Let adapters translate the same core failure into their transport's result shape.

Core code should not print. MCP reserves stdout for protocol messages, and library output makes behavior difficult to compose. The CLI writes successful JSON to stdout and structured failures to stderr. Additional instrumentation can be introduced at the public boundary when a demonstrated troubleshooting need justifies it.

## MCP and CLI parity

MCP is the primary product interface. The CLI exists as an equivalent scripting, testing, and recovery path.

- Both adapters call the same core operations.
- Keep result data semantically identical across transports.
- Do not implement separate CLI workflows or human-oriented business logic.
- Keep MCP tool descriptions and `continuum_guide` useful enough for agents to apply the primitives correctly.
- Add a new operation only when composition of the existing operations cannot express a demonstrated need clearly.

## Dependencies

A dependency should absorb real complexity or provide a well-understood primitive.

Prefer the existing stack and one obvious way to perform each concern. Keep dependency-specific APIs localized so ordinary feature code does not require broad framework knowledge.

Before adding a dependency, compare its conceptual cost with the amount of code and maintenance it actually removes. Small direct implementations are often preferable for stable, narrow behavior; established libraries are preferable at genuinely complex protocol boundaries.

## Tests

Tests exist to protect valuable behavior and make change safer.

Prioritize:

- record immutability and supersession
- workspace resolution and isolation
- FTS relevance, filtering, and pagination
- migration and transaction behavior
- MCP and CLI contract parity
- failures that would otherwise be easy to reintroduce

Prefer tests through a package's public interface using a real temporary SQLite database. Mock a boundary when the boundary itself is slow, nondeterministic, or outside the process—not merely to isolate every function.

Keep tests with the package that owns the behavior. Reserve root-level tests for genuine cross-package execution. Avoid coverage targets, broad snapshots, assertions about internal call choreography, and tests created only because a new file exists.

Use the smallest verification that proves the change, then widen when the affected boundary warrants it.

## Comments and documentation

Comments should preserve context that the code cannot express cleanly:

- why a non-obvious tradeoff was chosen
- what constraint a boundary protects
- why an apparently simpler approach loses correctness
- how a public contract is intended to be used

Do not narrate syntax, duplicate type definitions in prose, or explain temporary implementation details as durable architecture. Improve unclear names and structure before adding a long explanation.

Keep one owner for each kind of documentation:

- product usage in `README.md`
- contributor setup and commands in `CONTRIBUTING.md`
- product and architectural values in `AGENTS.md`
- coding taste in this document

Delete stale guidance rather than leaving several generations of architecture for a reader to reconcile.

## Formatting and focused verification

Use the repository's Prettier configuration and TypeScript checks as low-friction mechanical tools:

```sh
bun run format
bun run typecheck
bun test
```

Run focused package tests while developing, then use broader checks when a change crosses package boundaries. Formatting and typechecking support readability and correctness; they are not substitutes for design judgment.

Do not add custom architectural invariant scripts, line-count enforcement, coverage gates, Git hooks, or similar compliance machinery unless a concrete recurring failure demonstrates that automation is the clearest solution.
