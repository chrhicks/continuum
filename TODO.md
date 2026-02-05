# Implementation TODOs

## Core Data Structures & Formats

- [x] SPEC.md - Comprehensive specification
- [x] Example files (NOW, RECENT, MEMORY, consolidation.log)
- [x] Memory Manager SKILL.md
- [x] Main README.md
- [x] YAML schema definitions for validation
- [x] Memory file format validators

## Continuum CLI Implementation

### Phase 1: Foundation (v0.1)
- [x] `continuum memory init` - Initialize memory directory structure
  - [x] Create `.continuum/memory/`  
  - [x] Create `.gitignore`
  - [x] Create stub consolidation.log
- [x] `continuum memory session start` - Create new NOW file
  - [x] Generate timestamped filename
  - [x] Write YAML frontmatter
  - [x] Handle session linking (parent_session)
- [x] `continuum memory session end` - Mark session complete
  - [x] Update timestamp_end in NOW.md
  - [x] Calculate duration
  - [x] Optionally trigger consolidation
- [x] `continuum memory status` - Show memory statistics
  - [x] Current NOW file age, line count
  - [x] RECENT.md line count
  - [x] Last consolidation time
  - [x] Total memory size

### Phase 2: Consolidation (v0.2)
- [x] `continuum memory consolidate` - Core consolidation logic
  - [x] Read NOW.md with frontmatter parsing
  - [x] Append to RECENT.md with proper formatting
  - [x] Enforce 3-session limit in RECENT
  - [x] Create/update MEMORY-{date}.md
  - [x] Update MEMORY.md index
  - [x] Write consolidation.log
  - [x] Support dry-run mode (`--dry-run`)
  - [ ] Clear NOW.md (atomic operation)
- [ ] Error handling for file operations
  - Lock files for concurrency
  - Atomic writes (temp + rename)
  - Backup on error
- [ ] Session end automation
  - Detect /exit command
  - Detect SIGINT (Ctrl+C)
  - Hook into OpenCode lifecycle

### Phase 3: Intelligence (v0.3)
- [ ] Pattern extraction engine
  - Decision detection: "Decided:", "Chose:", "We agreed:", etc.
  - Discovery detection: "Found:", "Discovered:", "Realized:", etc.
  - Pattern detection: "Pattern:", "Always:", "Usually:", etc.
  - Task detection: Task IDs, task titles
  - File detection: Code paths, file extensions
- [ ] Tag extraction from content
  - Keywords from conversation
  - Task tags
  - File types and locations
- [ ] Importance scoring
  - Length of discussion topic
  - Number of related tasks
  - User emphasis ("important", "critical")
  - Agent explicit markers (`@important`, `@pattern`)
- [ ] Link generation
  - Git commit hashes → link to GitHub/GitLab
  - Task IDs → link to continuum tasks
  - File paths → link to code locations

### Phase 4: Query & Debug (v0.4)
- [x] `continuum memory search <query>`
  - [x] Search across NOW, RECENT, MEMORY
  - [x] Tier-specific search (`--tier=MEMORY`)
  - [ ] Tag-based search (`--tags=auth,security`)
  - [ ] Date-range search (`--after=2026-01-01`)
- [x] `continuum memory log`
  - [x] Show consolidation history
  - [ ] Filter by action type
  - [ ] Show diffs of what changed
- [x] `continuum memory recover`
  - [x] Check for stale NOW files (configurable threshold)
  - [x] Offer consolidation of stale sessions
  - [x] Handle interrupted consolidations
- [x] `continuum memory validate`
  - [x] Check file integrity
  - [x] Validate YAML frontmatter
  - [x] Verify internal links

### Phase 5: Advanced (v1.0)
- [ ] Configuration file support
  - `.continuum/memory/config.yml`
  - Override defaults (sizes, limits, triggers)
- [ ] Scheduled consolidation (cron integration)
  - `continuum memory schedule --daily 2am`
  - Run as background service
- [ ] Security features
  - PII detection and scrubbing
  - Secret detection (API keys, tokens)
  - Optional encryption
- [ ] Performance optimizations
  - Incremental consolidation (only changed parts)
  - Parallel processing for large sessions
  - Memory-mapped files for speed
- [ ] Team features
  - Shared MEMORY.md (opt-in)
  - Conflict resolution for shared memory
  - Memory merging across contributors

## Working Agent Integration

- [ ] Auto-write to NOW.md
  - Hook into OpenCode message loop
  - Append user messages with markdown formatting
  - Log tool calls and results
  - Update YAML metadata (line count, tags)
- [ ] Session lifecycle hooks
  - `session_start()` → trigger `continuum memory session start`
  - `session_end()` → trigger `continuum memory session end`
- [ ] Smart consolidation suggestions
  - Detect when session is getting long (>100 lines)
  - Detect when important decisions are made
  - Suggest consolidation: "Session has 150 lines and decisions about auth. Consolidate?"
- [ ] Context retrieval from memory
  - On session start: read RECENT.md and MEMORY.md
  - Summarize relevant context for user
  - Answer "what did we work on last time?"

## Testing

### Unit Tests
- [ ] YAML frontmatter parsing
- [ ] Timestamp generation and formatting
- [ ] File locking mechanism
- [ ] Atomic write operations
- [ ] Consolidation logic for simple cases
- [ ] Pattern extraction regex patterns
- [ ] Tag generation
- [ ] Search functionality

### Integration Tests
- [ ] End-to-end consolidation cycle
  - Create NOW.md → consolidate → verify RECENT.md → verify MEMORY.md
- [ ] Session rollover (auto at 200 lines)
- [ ] Recovery from failures
- [ ] Concurrent consolidation attempts (should serialize)
- [ ] Working agent integration (real OpenCode session)

### Example Data
- [ ] Sample NOW files (various sizes)
- [ ] Sample conversation transcripts
- [ ] Known patterns for testing extraction
- [ ] Edge cases (empty sessions, very long sessions)

## Documentation

- [x] SPEC.md - Complete specification
- [x] README.md - User-facing quick start
- [x] Example files - NOW, RECENT, MEMORY, consolidation.log
- [ ] SKILL.md - Memory manager instructions
- [ ] CLI help text - `continuum memory --help`
- [ ] Migration guide - From opencode-continuum to memory system
- [ ] Advanced configuration guide
- [ ] Troubleshooting FAQ
- [ ] Architecture diagram

## Open Questions

- [ ] Should NOW.md be written in real-time or on-demand?
- [ ] How to detect session end reliably? (SIGINT, /exit, timeout)
- [ ] What triggers automatic consolidation? (size, time, user, agent)
- [ ] How to handle multi-agent scenarios? (same session? separate?)
- [ ] Should we support multiple NOW files for parallel work?
- [ ] How to integrate with existing opencode-continuum tasks?
- [ ] What's the right heuristic for importance scoring?
- [ ] Should MEMORY.md be committed or gitignored by default?
- [ ] How to version memory manager skill itself?
- [ ] What happens when memory gets too large? (archival strategy?)

## Release Checklist

### v0.1 (MVP)
- [ ] All core CLI commands working
- [ ] Basic consolidation NOW→RECENT
- [ ] Working agent can write to NOW.md
- [ ] Documentation complete
- [ ] Example files included

### v0.2 (Usable)
- [ ] Pattern extraction working
- [ ] MEMORY.md index generation
- [ ] Search functionality
- [ ] Recovery commands
- [ ] Performance acceptable (<5s consolidation)

### v0.3 (Polished)
- [ ] Importance scoring heuristic
- [ ] Auto-consolidation triggers
- [ ] Configuration file support
- [ ] Comprehensive test suite
- [ ] User feedback incorporated

### v1.0 (Production Ready)
- [ ] Security features (PII scrubbing, encryption)
- [ ] Performance optimized
- [ ] Team/shared memory features
- [ ] Advanced query capabilities
- [ ] Long-term stability testing (100+ sessions)
