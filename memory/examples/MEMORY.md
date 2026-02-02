# Long-term Memory Index

*Generated: 2026-02-01 12:00 UTC | Last Consolidated: 2026-02-01 11:45 UTC*

## Architecture Decisions
- **[Auth Architecture](MEMORY-2026-02-01.md#auth)** - Cookie vs JWT decision, tradeoffs and final approach (Feb 2026)
- **[API Design Philosophy](MEMORY-2026-01-20.md#api)** - REST vs GraphQL, resource naming conventions (Jan 2026)
- **[Middleware Strategy](MEMORY-2026-01-31.md#middleware)** - Composition pattern, execution order, error handling (Jan 2026)

## Technical Discoveries
- **[JWT Timezone Bug](MEMORY-2026-02-01.md#bugs)** - Library v3.2 issue, UTC normalization workaround, test case (Feb 2026)
- **[Rate Limiting Performance](MEMORY-2026-01-31.md#performance)** - Custom vs express-rate-limit, 40% improvement, memory usage (Jan 2026)
- **[Database Deadlocks](MEMORY-2026-01-30.md#db-issues)** - Foreign key constraints under load, resolution pattern (Jan 2026)

## Development Patterns
- **[Error Handling Pattern](MEMORY-2026-01-20.md#patterns)** - Custom error classes, middleware error handling, user-friendly messages
- **[Testing Strategy](MEMORY-2026-01-25.md#patterns)** - Unit vs integration test split, test data factories, CI integration
- **[Migration Procedure](MEMORY-2026-01-30.md#patterns)** - Incremental approach, rollback procedures, performance benchmarks

## Tooling & Workflow
- **[Memory Management Process](MEMORY-2026-01-31.md#workflow)** - Consolidation triggers, file organization, search strategies
- **[Task Management](MEMORY-2026-01-15.md#workflow)** - Using opencode-continuum, task hierarchy, status transitions

## Project Milestones
- **[Phase 1: Auth & API](MEMORY-2026-02-01.md#milestones)** - Foundation complete, JWT bug fixed, rate limiting implemented (Feb 2026)
- **[Phase 2: Database](MEMORY-2026-01-30.md#milestones)** - Migration system, performance optimization, deadlock resolution (Jan 2026)

## Cross-Cutting Concerns
- **[Security Considerations](MEMORY-2026-01-20.md#security)** - Auth token storage, rate limiting thresholds, input validation
- **[Performance Patterns](MEMORY-2026-01-31.md#performance)** - Redis caching, query optimization, middleware overhead

---

*Index generated from 15 sessions across 3 weeks*
*Total Memory Size: 2.3 MB across 12 files*
