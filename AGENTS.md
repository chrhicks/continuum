# Continuum

Continuum gives coding agents durable, long-term memory. It preserves useful observations, decisions, preferences, and lessons beyond one conversation so an agent can recover context instead of repeating investigation.

MCP is the primary interface. The CLI mirrors the same capabilities as a parity, scripting, and recovery surface rather than becoming a separate product.

The repository is undergoing an intentional rebuild. Existing behavior reflects an earlier product that accumulated an SDK, task management, CLI workflows, memory projections, consolidation, and session recall over time. That history is not an architectural requirement. Preserve the value of Continuum, not every mechanism it has used.

## What Continuum should protect

### 1. Durable memory remains faithful

A memory record is valuable because later agents can trust that it still contains what was originally learned. Records should be immutable and retain their complete content. New knowledge may supersede old knowledge, but history should not be silently rewritten or hidden behind a lossy summary.

Derived data may eventually improve retrieval, but it should not replace canonical evidence or make that evidence harder to find.

### 2. Retrieval is part of the product

Storing information is only useful when an agent can recover the right information during real work. Search should favor relevant results, preserve enough context for an agent to interpret them, and provide a straightforward way to browse when a targeted query is insufficient.

Agents are good at reading and synthesizing a useful set of records. Prefer giving them faithful, well-ranked evidence over building increasingly elaborate systems that attempt to interpret the evidence for them.

### 3. The interface stays small and composable

Continuum is normally used through code-mode MCP clients such as Executor. Small data-oriented operations compose better there than workflow-oriented tools.

The intended surface is a guide, a recent workspace briefing, immutable recording, search or browsing, and exact retrieval. A new operation should answer a demonstrated need that cannot be expressed clearly by composing those primitives.

The CLI should expose the same product behavior and structured results. Avoid creating separate human and agent implementations.

### 4. Memory belongs to a logical workspace

Memory should survive deleted checkouts and fresh clones. A central local database owns records for many isolated workspaces; repository remotes and filesystem paths help resolve a checkout to its logical identity.

Cross-workspace retrieval, network hosting, and synchronization are plausible futures, not current requirements. Keep the present design honest while leaving those changes possible through clear boundaries.

### 5. Understandability is an architectural requirement

A mid-level TypeScript engineer should be able to browse the repository, find a capability, and trace an MCP request to its database behavior without learning incidental machinery.

If an ordinary operation requires navigating many layers, framework-specific control flow, generic service plumbing, or indirect re-export chains, treat that friction as design feedback. First try clearer names, stronger boundaries, or a more direct flow rather than adding explanatory machinery around a complicated design.

Sophisticated implementation is appropriate for a genuinely difficult problem. Isolate it behind a small interface so the critical path remains legible.

### 6. Package boundaries express real responsibilities

Continuum uses workspace packages to make important interfaces and dependency direction explicit, not to prepare code for publication.

The intended dependency shape is:

```text
apps/cli ───────→ packages/core
    │
    └───────────→ packages/mcp ───────→ packages/core
```

- `packages/core` owns workspace identity, memory behavior, retrieval, and SQLite persistence.
- `packages/mcp` adapts the public core operations to MCP.
- `apps/cli` is the executable and composition point for CLI and MCP operation.
- `tools` may contain focused operational utilities, such as a one-time legacy importer, without making them part of the runtime architecture.

Add another package when an independently meaningful boundary emerges. Do not reproduce domain, application, repository, and infrastructure layers merely to make the package graph look architectural.

## Product boundaries

Continuum currently focuses on workspace memory. It is not also a:

- task or project management system
- general SDK for embedding task behavior in other applications
- coding-session archive or provider-specific recall service
- generated Markdown memory system
- consolidation or summarization pipeline
- plugin ecosystem
- cross-workspace knowledge graph
- network synchronization service
- vector or embedding platform

These are boundaries, not predictions that Continuum can never grow. Reconsider one when real usage demonstrates that it belongs in the product.

## Engineering taste

Make the critical path read like the operation being performed. Prefer direct TypeScript, explicit data flow, cohesive feature modules, narrow package exports, and dependencies that absorb more complexity than they introduce.

Use abstractions to reveal a stable concept or protect a meaningful boundary. Do not introduce interfaces, registries, service containers, generic repositories, or extension mechanisms in anticipation of variation that does not exist.

Keep framework knowledge near its boundary. MCP transport concerns belong in the MCP package; CLI parsing belongs in the CLI app; storage and search behavior belong in core. A feature should not need to understand how another adapter delivers it.

See [CODING_STANDARDS.md](./CODING_STANDARDS.md) for concrete coding defaults.

## Working together

Challenge speculative scope and unnecessary complexity early. Explain the concrete maintenance cost and offer a smaller alternative. Once the tradeoff is understood and a direction is chosen, support it rather than repeatedly relitigating it.

Prefer discussing uncertain product or architectural decisions before encoding them in a large implementation. During implementation, work in coherent vertical checkpoints that preserve a runnable critical path.

Tests provide confidence, not a coverage score. Documentation preserves durable intent, not temporary implementation narration. Deletion is a useful design tool when history has left behavior, files, or abstractions that no longer serve Continuum.

Treat this document as guidance for judgment. When it conflicts with a concrete need, make the tension visible and resolve it deliberately rather than obeying the prose mechanically.

## Repository guidance

- [README.md](./README.md) describes the product and its public usage.
- [CONTRIBUTING.md](./CONTRIBUTING.md) owns setup, commands, and contributor workflow.
- [CODING_STANDARDS.md](./CODING_STANDARDS.md) describes coding taste and verification defaults.

Harness-specific instructions for using Continuum do not belong here. Keep them in the environment that needs them or obtain generic usage guidance through `continuum_guide`.
