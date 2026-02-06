# RECENT - Last 3 Sessions

## Session 2026-02-01 10:30-11:45 (1h 15m)

**Focus**: Authentication bugfix and test coverage

**Key Decisions**:

- Fixed JWT timezone validation bug in `src/auth/middleware.ts:45`
- Created new rate limiting task (tkt_rate_890) for API protection
- Established pattern: Comprehensive tests for auth changes

**Discoveries**:

- JWT library v3.2 has known timezone handling issues
- Workaround implemented using UTC normalization
- Rate limiting should be applied at middleware level, not route level

**Tasks**: tkt_auth_456, tkt_bug_789, tkt_rate_890 (created)
**Files**: `src/auth/middleware.ts`, `test/auth-timezone.test.ts`, `opencode.json`
**Link**: [Full details](MEMORY-2026-02-01.md#session-2026-02-01)

---

## Session 2026-01-31 14:00-17:30 (3h 30m)

**Focus**: API rate limiting implementation

**Key Decisions**:

- Implemented sliding window rate limiter (60 req/min)
- Added Redis backend for distributed rate limiting
- Created reusable middleware pattern

**Discoveries**:

- Express rate-limit package has memory leak under load
- Custom implementation performs 40% better in benchmarks
- Need to add rate limiting to WebSocket connections (future)

**Tasks**: tkt_api_234, tkt_perf_567
**Files**: `src/middleware/rate-limit.ts`, `test/rate-limit.test.ts`
**Link**: [Full details](MEMORY-2026-01-31.md)

---

## Session 2026-01-30 09:00-12:15 (3h 15m)

**Focus**: Database migration strategy

**Key Decisions**:

- Adopted incremental migration approach (not big-bang)
- Created rollback procedures for each migration
- Documented migration patterns in `docs/migrations.md`

**Discoveries**:

- Production migration takes 30% longer than expected
- Need to add migration performance benchmarks
- Foreign key constraints cause deadlocks under load

**Tasks**: tkt_db_123, tkt_docs_456
**Files**: `migrations/001-users.sql`, `migrations/002-posts.sql`, `docs/migrations.md`
**Link**: [Full details](MEMORY-2026-01-30.md)
