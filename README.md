# Continuum Memory System

A 3-tier file-based memory system for OpenCode agents that captures and consolidates project context across sessions.

## Quick Start

```bash
# Initialize memory system in your project
continuum memory init

# Start a new session (auto-created when you start OpenCode)
continuum memory session start

# Work normally... agent writes to NOW.md automatically

# When done, consolidate memory
continuum memory consolidate

# View recent work
continuum memory status
```

## Architecture

### Three Memory Tiers

```
NOW ──→ RECENT ──→ MEMORY
 │         │          │
 │         │          └─ Long-term curated knowledge
 │         └─ Summary of last 3 sessions
 └─ Current session transcript (200 lines max)
```

**NOW** (`.continuum/memory/NOW-{date}T{time}.md`)
- Current session transcript
- Live-updated as you work
- Auto-rollover at 200 lines or 6 hours

**RECENT** (`.continuum/memory/RECENT.md`)
- Summary of last 3 sessions
- Key decisions, discoveries, patterns
- Quick context refresh

**MEMORY** (`.continuum/memory/MEMORY.md` + `MEMORY-{date}.md`)
- Long-term consolidated knowledge
- Index + detailed content files
- Organized by theme, searchable

## File Structure

```
.continuum/
├── continuum.db              # Tasks (existing)
└── memory/
    ├── .gitignore
    ├── NOW-2026-02-01T10-30.md     # Current session
    ├── RECENT.md                   # Recent sessions summary
    ├── MEMORY.md                   # Long-term memory index
    ├── MEMORY-2026-02-01.md        # Consolidated content
    ├── consolidation.log           # Audit trail
    └── examples/                   # Example files
```

## Usage

### Session Management

```bash
# Start new session (usually auto-triggered)
continuum memory session start

# End session and consolidate (usually auto-triggered)
continuum memory session end

# Check session status
continuum memory status
```

### Manual Consolidation

```bash
# Consolidate NOW → RECENT → MEMORY
continuum memory consolidate

# See what would be consolidated (dry run)
continuum memory consolidate --dry-run

# Verbose output
continuum memory consolidate --verbose
```

### Querying Memory

```bash
# Search across all memory tiers
continuum memory search "authentication"

# Search specific tier
continuum memory search "auth" --tier=MEMORY

# View recent sessions (human-readable)
continuum memory show --tier=RECENT

# Show memory index
continuum memory show --tier=MEMORY
```

### Recovery & Debug

```bash
# Check for stale sessions
continuum memory recover

# View consolidation history
continuum memory log --tail 30

# Show memory statistics
continuum memory status --verbose
```

## Agent Loop (Batch Mode)

Run an autonomous loop that picks tasks, works them, runs QA, and consolidates memory between sessions.

```bash
# Run up to 5 tasks
bun run bin/continuum loop -n 5
```

How it works:
- Writes a loop request to `.continuum/loop/request.json`
- The Agent Loop Skill (`skills/agent-loop/SKILL.md`) consumes the request
- Each task runs in a fresh NOW session with consolidation after completion
- QA policy: `bun test` + task-specific steps (if provided) + minimal smoke test

## How It Works

### Auto-Documentation

The working agent automatically maintains `NOW.md` during your session:

```markdown
---
session_id: sess_abc123
timestamp_start: 2026-02-01T10:30:00Z
timestamp_end: null
tags: [auth, bugfix]
related_tasks: [tkt_456]
---

## User: I need to fix authentication

## Agent: I'll help debug this. Let me check the code.

[Tool: Read src/auth/middleware.ts]

## Agent: Found the bug on line 45 - timezone issue in JWT verification
```

### Consolidation Process

When triggered, the Memory Manager Skill:

1. **Reads** NOW.md and extracts patterns
2. **Updates** RECENT.md with session summary
3. **Creates/Updates** MEMORY-{date}.md with detailed knowledge
4. **Indexes** in MEMORY.md by theme
5. **Logs** all actions for audit
6. **Cleans up** old NOW files

### Important vs. Routine

**Extracted as important:**
- Decisions: "Switched from JWT to cookies"
- Discoveries: "Library v3.2 has timezone bug"
- Patterns: "Middleware should validate before auth"
- Failures: "Rate limiter memory leak under load"

**Condensed or discarded:**
- Routine: "ls -la src/auth"
- Boilerplate: Standard tool output
- Dead ends: Experiments that taught nothing

## Examples

See `memory/examples/` for complete example files:

- `NOW-2026-02-01T10-30.md` - Sample session transcript
- `RECENT.md` - Recent sessions summary
- `MEMORY.md` - Memory index with links
- `MEMORY-2026-02-01.md` - Consolidated knowledge
- `consolidation.log` - Audit trail

## OpenCode Skill

The memory manager is implemented as an OpenCode skill:

**Location**: `.continuum/skills/memory-manager/SKILL.md`

**Trigger**: Automatically loaded when you say:
- "consolidate my memory"
- "reflect on recent work"
- "/exit" (session end)

## Configuration (Optional)

Create `.continuum/memory/config.yml` to customize:

```yaml
# Session auto-rollover limits
now_max_lines: 200
now_max_hours: 6

# RECENT session retention
recent_session_count: 3
recent_max_lines: 500

# Auto-consolidation
auto_consolidate_on_exit: true
auto_consolidate_schedule: null  # Future: "0 2 * * *"

# Memory sections
memory_sections:
  - Architecture Decisions
  - Technical Discoveries
  - Development Patterns
```

## Implementation Status

### v0.1 (Current)
- [x] Directory structure and file formats
- [x] YAML frontmatter specification
- [x] Memory Manager Skill template
- [x] Example files
- [ ] CLI commands (TODO)
- [ ] Working agent integration (TODO)
- [ ] Consolidation logic (TODO)

### v0.2 (Next)
- [ ] `continuum memory consolidate` command
- [ ] Basic NOW → RECENT rollover
- [ ] Memory log generation
- [ ] Session start/end hooks

### v0.3
- [ ] Pattern extraction (decisions, discoveries)
- [ ] MEMORY.md index generation
- [ ] Tag extraction
- [ ] Search functionality

### v0.4
- [ ] Recovery commands
- [ ] Dry-run mode
- [ ] Status and statistics
- [ ] Documentation

### v1.0
- [ ] Scheduled consolidation (cron)
- [ ] Security scrubbing (PII detection)
- [ ] Performance optimization
- [ ] Git integration options

## Design Principles

1. **File-based**: Simple, inspectable, version-controlled
2. **Tiered**: NOW for capture, RECENT for context, MEMORY for wisdom
3. **Lazy**: Consolidate asynchronously, don't block active work
4. **Curated**: Extract signal from noise, prioritize importance
5. **Recoverable**: Clear audit trail, backup strategy, idempotent operations

## Security Notes

**v0 (Current)**: Memory is gitignored by default. No secrets scrubbing yet. Suitable for development.

**v1 (Future)**: Will add PII detection, optional encryption, access controls.

## Troubleshooting

### Nothing is being written to NOW.md
- Check that working agent loaded the memory plugin
- Verify `.continuum/memory/` directory exists and is writable
- Look for errors in agent logs: `opencode log`

### Consolidation fails
- Check permissions: `ls -la .continuum/memory/`
- Try dry-run: `continuum memory consolidate --dry-run`
- View log: `continuum memory log --tail 20`

### Memory seems wrong/incomplete
- Edit files directly: `vim .continuum/memory/RECENT.md`
- Run manual consolidation: `continuum memory consolidate`
- Provide feedback: Note issues in chat, memory manager will learn

## Contributing

This is part of the opencode-continuum project. See main README for contribution guidelines.

## License

MIT
