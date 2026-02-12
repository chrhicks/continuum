# 3-Tier Memory System - Comprehensive Specification

## Overview

A file-based memory system for OpenCode agents that provides context persistence across sessions through three tiers: NOW (current), RECENT (last few sessions), and MEMORY (long-term consolidated knowledge).

## Task CLI (MVP)

Task metadata lives in `.continuum/continuum.db` and is available via the CLI.

```bash
continuum init
continuum task init
continuum task list [--status=<status>] [--type=<type>]
continuum task view <task_id> [--tree]
```

## Architecture

### Three Memory Tiers

#### **NOW - Current Session Context**

- **Location**: `.continuum/memory/NOW-{ISO-date}T{HH-MM}[ -{suffix}].md`
- **Purpose**: Live capture of current working session
- **Lifetime**: Created at session start, consolidated when session ends or when size/time limits reached
- **Max Size**: 200 lines or 6 hours (whichever comes first)
- **Format**: Plain markdown with optional YAML frontmatter

**Frontmatter**:

```yaml
---
session_id: sess_abc123
timestamp_start: 2026-02-01T10:30:00Z
timestamp_end: null # Set when session ends
duration_minutes: null
project_path: /home/user/projects/continuum
tags: [auth, bugfix]
parent_session: sess_abc122
related_tasks: [tkt_456, tkt_789]
memory_type: NOW
---
```

**Content**: Conversation transcript, agent actions, and tool calls (results optional)

### Configuration (Optional)

**Location**: `.continuum/memory/config.yml`

Supported keys:

- `now_max_lines`
- `now_max_hours`
- `recent_session_count`
- `recent_max_lines`
- `memory_sections`

#### **RECENT - Last 3 Sessions Summary**

- **Location**: `.continuum/memory/RECENT.md`
- **Purpose**: Distilled summary of recent work for quick context retrieval
- **Lifetime**: Rolling window of last 3 sessions (not time-based)
- **Max Size**: ~500 lines (configurable)
- **Format**: Structured sections with links to full MEMORY files

**Structure**:

```markdown
# RECENT - Last 3 Sessions

## Session 2026-02-01 morning (2.5h)

**Focus**: Authentication bugfix

**Key Decisions**:

- Switched from JWT to cookie-based auth
- Created middleware in `src/middleware/auth.ts`

**Discoveries**:

- Session regeneration bug in v5.2.0
- Workaround: Disable concurrent requests

**Patterns**:

- Add middleware for cross-cutting concerns

**Tasks**: tkt_456, tkt_789
**Files**: `src/middleware/auth.ts`
**Link**: [Full details](MEMORY-2026-02-01.md#session-2026-02-01)

## Session 2026-01-31 afternoon (1.5h)

**Focus**: API rate limiting
...
```

#### **MEMORY - Long-term Consolidated Knowledge**

- **Location**: `.continuum/memory/MEMORY.md` (index) + `.continuum/memory/MEMORY-{date}.md` (content files)
- **Purpose**: Curated, organized knowledge that persists across weeks/months
- **Lifetime**: Permanent (but can be archived)
- **Format**: Index file linking to consolidated content by theme

**Index Structure (MEMORY.md)**:

```markdown
# Long-term Memory Index

## Architecture Decisions

- [Auth Approach](MEMORY-2026-01-15.md#auth) - Cookie vs JWT decision, Jan 2025
- [API Design](MEMORY-2026-02-01.md#api) - REST vs GraphQL discussion, Feb 2025

## Technical Discoveries

- [Session Regeneration Bug](MEMORY-2026-01-31.md#bugs) - Affects v5.2.0, workaround documented

## Development Patterns

- [Error Handling](MEMORY-2026-01-20.md#patterns) - Custom error classes approach

## Sessions

- [Phase 1 Completion](MEMORY-2026-02-01.md#milestones) - Auth + API foundation ready
```

**Content File Structure (MEMORY-2026-01-15.md)**:

```markdown
---
consolidation_date: 2026-01-15T02:00:00Z
source_sessions: [sess_abc120, sess_abc121, sess_abc122]
total_sessions_consolidated: 3
tags: [auth, architecture, decisions]
consolidated_by: continuum-cli-v0.1
---

# Consolidated Memory

## Session 2026-01-15 02:00 UTC (sess_abc120)

<a name="session-2026-01-15-02-00-sess_abc120"></a>

**Focus**: Auth architecture decision

**Decisions**:

- JWT vs cookie: selected cookies with httpOnly/secure flags

**Discoveries**:

- Session regeneration bug in v5.2.0

**Patterns**:

- Use middleware for cross-cutting concerns

**Tasks**: tkt_456, tkt_789
**Files**: `src/middleware/auth.ts`, `docs/auth.md`
```

### **Consolidation Log**

- **Location**: `.continuum/memory/consolidation.log`
- **Purpose**: Audit trail of all consolidation operations
- **Format**: Chronological entries with action, files, and changes

**Log Entry Format**:

```
[2026-02-01 11:45:00 UTC] ACTION: Consolidate NOW→RECENT→MEMORY (Marker-based)
  Files:
    - .continuum/memory/NOW-2026-02-01T10-30.md
    - .continuum/memory/RECENT.md
    - .continuum/memory/MEMORY-2026-02-01.md
  Extracted: 2 decisions, 1 discoveries, 0 patterns

[2026-02-01 02:00:00 UTC] ACTION: Scheduled consolidation
  Files: NOW-2026-01-31T*.md, NOW-2026-02-01T*.md
  Changes:
    - Created MEMORY-2026-02-01.md with auth architecture
    - Updated MEMORY.md index (3 new entries)
    - RECENT.md: GC'd sessions older than 3 days
```

## Actors & Responsibilities

### **User**

- Manually triggers consolidation via CLI or natural language
- Reviews and edits MEMORY.md
- Provides feedback on memory quality
- Decides what gets committed (if at all)

### **Working Agent**

- Writes session transcripts to NOW.md in real-time
- Appends YAML frontmatter with context
- Can suggest consolidation when appropriate
- Queries MEMORY.md and RECENT.md for context

### **Memory Manager Skill**

- Triggered manually, on session end, or via cron
- Reads NOW.md and RECENT.md
- Applies heuristics: extracts decisions, patterns, discoveries
- Updates RECENT.md (rolling window)
- Appends structured entries to MEMORY.md and creates content files
- Writes consolidation.log
- Manages garbage collection of old NOW files

## Trigger Mechanisms

### **Manual User Trigger**

```bash
# CLI
continuum memory consolidate

# Natural language in chat
User: "consolidate my memory"
User: "reflect on recent work"
```

### **Manual Agent Trigger**

```
Working Agent: "This session is getting long. Should I consolidate memory?"
User: "yes"
→ Agent triggers memory manager skill
```

### **Session End Trigger**

```bash
# User exits
/exit
Ctrl+C
→ OpenCode detects exit
→ Triggers memory manager if configured
```

### **Scheduled Trigger (Future)**

```bash
# In user's crontab
0 2 * * * cd /path/to/project && continuum memory consolidate --scheduled
```

## Implementation Roadmap

### **Phase 1: Foundation (v0.1)**

- [x] Create memory directory structure
- [x] Implement continuum CLI commands:
  - `continuum memory init`
  - `continuum memory session start`
  - `continuum memory session end`
- [x] Working agent writes to NOW.md
- [x] Basic YAML frontmatter support

### **Phase 2: Consolidation (v0.2)**

- [x] Memory manager skill skeleton
- [x] Read NOW.md → append to RECENT.md
- [x] Basic summarization heuristics
- [x] Create consolidation.log
- [x] Implement `continuum memory consolidate`

### **Phase 3: Intelligence (v0.3)**

- [x] Pattern extraction: decisions, discoveries, bugs
- [x] MEMORY.md index generation
- [ ] Tag extraction and organization
- [x] Link generation between memory files

### **Phase 4: Polish (v0.4)**

- [x] Add `continuum memory search`
- [x] Add `continuum memory status`
- [x] Add recovery commands
- [x] Add dry-run mode
- [x] Add `continuum memory validate`
- [x] Add `continuum memory log`
- [x] Documentation and examples

### **Phase 5: Advanced (v1.0)**

- [x] Automated size/time triggers
- [ ] Scheduled consolidation via cron
- [ ] Security: PII scrubbing
- [ ] Git integration options
- [ ] Performance optimization

## Error Handling & Recovery

### **Stale NOW Files**

- Check for NOW files older than 24 hours
- On next session start: prompt to consolidate
- Recovery command: `continuum memory recover`

### **Corrupted Files**

- Validate YAML frontmatter
- Backup before consolidation: `.continuum/memory/backup/` (planned)
- Atomic writes: write to temp file, then rename (planned)

### **Git Conflicts**

- `.continuum/memory/` in `.gitignore` by default
- For team-shared memory: opt-in via `continuum memory git track`
- Manual conflict resolution: show diffs, allow user to choose

## Security Considerations (v1)

- Secrets detection in transcripts
- Option to mark files as private: `NOW-2026-02-01.md.private`
- Audit log: what was consolidated, when, by whom
- Access controls: who can trigger consolidation, edit memory

## Testing Strategy

- Unit tests for CLI commands
- Integration tests for full consolidation cycle
- Example memory files for testing
- Mock working agent for generating test transcripts
