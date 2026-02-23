---
name: memory-manager
description: 'Consolidate NOW/RECENT/MEMORY files for Continuum sessions.'
license: MIT
compatibility: opencode
metadata:
  trigger: manual_user_request, manual_agent_request, session_end
  priority: '800'
  requires_state: writable,no_active_agent
  min_version: '0.1.0'
---

# Memory Manager Skill

## Purpose

Maintain a 3-tier memory system (NOW → RECENT → MEMORY) that captures and consolidates project context across OpenCode sessions. This skill runs asynchronously to preserve working agent performance.

## Memory Architecture

### Three Tiers

1. **NOW** (Current): Live session capture, ~200 lines max
2. **RECENT** (Last 3 sessions): Summary for continuity, ~500 lines
3. **MEMORY** (Long-term): Consolidated knowledge, permanent archive

### File Locations

- `.continuum/memory/NOW-{date}T{time}.md` - Timestamped session files
- `.continuum/memory/RECENT.md` - Recent sessions summary
- `.continuum/memory/MEMORY.md` - Index linking to consolidated files
- `.continuum/memory/MEMORY-{date}.md` - Consolidated content by date
- `.continuum/memory/consolidation.log` - Audit trail

## When to Run

This skill triggers when:

- User explicitly requests: "consolidate memory", "reflect on recent work"
- Working agent suggests and user approves
- Session ends cleanly (/exit) or via Ctrl+C (SIGINT)
- (Future) Scheduled via cron for unattended consolidation

## Actions Performed

### 1. Analysis Phase

Reads and analyzes:

- `.continuum/memory/NOW-{latest}.md` - Current session transcript
- `.continuum/memory/RECENT.md` - Existing recent context
- `.continuum/tasks/` (via continuum plugin) - Related task data
- Git history - Recent commits for context

Identifies:

- **Decisions**: Key choices made with rationale
- **Discoveries**: Technical insights, bug root causes
- **Patterns**: Repeated approaches or anti-patterns
- **Tasks**: Created, completed, or blocked tasks
- **Files**: Code locations frequently referenced

### 2. Consolidation Phase

#### A. Update RECENT.md

- Append summary of latest NOW session
- Maintain only last 3 sessions (oldest dropped)
- Structure: Focus, Key Decisions, Discoveries, Tasks, Links
- Max size: ~500 lines

#### B. Update MEMORY.md Index

- Add entries to Architecture Decisions, Discoveries, Patterns, etc.
- Link to detailed content in MEMORY-{date}.md
- Organize by theme, not chronology
- Tag entries for searchability

#### C. Create/Update MEMORY-{date}.md

- Write structured, detailed summaries
- Include code examples when relevant
- Link back to tasks, files, commits
- Add tags and metadata for search

### 3. Cleanup Phase

- Clear NOW.md (after successful consolidation)
- Garbage collect NOW files older than 3 days
- Rotate consolidation.log if >1000 lines
- Update timestamps and metadata

## What to Extract as Important

### High Priority (Always Keep)

- **Decisions**: Why we chose X over Y, architecture choices
- **Discoveries**: Bug root causes, surprising behavior, library quirks
- **Failures**: What didn't work and why (negative knowledge)
- **Patterns**: Reusable approaches, established conventions
- **Milestones**: Project phase completions, releases

### Medium Priority (Condense)

- **Task progress**: Summarize, don't transcribe every step
- **Code changes**: Reference locations, don't duplicate code
- **Conversations**: Keep user-agent dialog, omit routine commands

### Low Priority (Discard)

- **Routine file operations**: ls, cd, git status
- **Tool boilerplate**: Standard command output
- **Failed experiments** that didn't teach us anything new
- **Temporary workarounds** that were later removed

### Special Cases

- **Repeated topics**: Note recurrence, link to previous discussions
- **Abandoned approaches**: Document why abandoned (future reference)
- **Security concerns**: Note but don't log secrets (use placeholders)

## Output Format

### RECENT.md Entry Structure

```markdown
## Session {date} {time} ({duration})

**Focus**: One-line summary

**Key Decisions**:

- [ ] Item 1
- [ ] Item 2

**Discoveries**:

- Discovery 1
- Discovery 2

**Tasks**: tkt_123, tkt_456
**Files**: `path/to/file.ts`, `path/to/test.ts`
**Link**: [Full details](MEMORY-{date}.md#anchor)
```

### MEMORY.md Index Entry

```markdown
- **[Title](MEMORY-{date}.md#anchor)** - Brief description, date, tags
```

### MEMORY-{date}.md Section

```markdown
## Section Title

**Date Range**: {start} to {end}
**Status**: IMPLEMENTED | IN PROGRESS | ABANDONED

### Summary

2-3 paragraphs explaining what happened and why it matters

### Implementation

Code examples, file paths, specific details

### Related Work

Tasks, commits, other sessions
```

## Error Handling

### If NOW.md is locked (another agent writing)

- Wait 5 seconds, retry up to 3 times
- If still locked: log warning, skip this consolidation
- Notify: "Memory consolidation skipped: session still active"

### If files are corrupted (invalid YAML, unreadable)

- Create backup: copy corrupted file to `.backup/`
- Try to parse best-effort, log warnings
- Continue with available data

### If consolidation fails mid-way

- Transaction log: write before each major step
- On failure: restore from last checkpoint
- Log error details for debugging

## Performance Considerations

- **Speed**: Consolidation should complete in <5 seconds for typical sessions
- **Memory Usage**: Load files incrementally, don't hold everything in memory
- **Disk Usage**: Compress old log files, GC old NOW files
- **Git**: If tracked, only commit MEMORY.md and RECENT.md (not NOW files)

## User Customization

Users can override defaults by creating `.continuum/memory/config.yml`:

```yaml
# Max lines before auto-rollover
now_max_lines: 200
now_max_hours: 6

# How many sessions to keep in RECENT
recent_session_count: 3
recent_max_lines: 500

# Memory organization
memory_sections:
  - Architecture Decisions
  - Technical Discoveries
  - Development Patterns
  - Tooling & Workflow

# Auto-consolidation triggers
auto_consolidate_on_exit: true
auto_consolidate_schedule: null # Future: "0 2 * * *"
```

## Debugging

### Check what would be consolidated

```bash
continuum memory consolidate --dry-run --verbose
```

### View consolidation history

```bash
continuum memory log --tail 20
```

### Search across all memory

```bash
continuum memory search "auth" --tier=all
```

## Integration with Working Agent

### Prompt for Working Agent

You should maintain real-time session transcript in NOW.md:

1. Create/open: `.continuum/memory/NOW-{ISO}.md`
2. For each exchange, append:

   ```markdown
   ## User: {message}

   ## Agent: {response}

   [Tool: {tool_name} - {summary}]
   ```

3. Update YAML frontmatter: increment lines, add tags, etc.
4. On session end: trigger this skill

### Suggesting Consolidation

When you notice:

- Session >100 lines or >3 hours
- Important decisions made
- User mentions "wrap up", "we're done", "let's consolidate"

Ask:

> This session contains important decisions about X and Y. Should I consolidate the memory now?

If user agrees, trigger: `skill("memory-manager")`

## Example Trigger Phrases

**User might say**:

- "consolidate my memory"
- "reflect on what we've learned"
- "summarize today's work"
- "update the project memory"
- "save this for future reference"
- "we're done for today"
- "/exit" (if watching for it)

**Agent should recognize**:

- "wrap up", "finish up", "call it a day" + session is long
- Multiple important decisions in one session
- Discovery of significant bug or pattern
- User frustration about repeating explanations

## Success Metrics

- [ ] Consolidation completes without errors
- [ ] Important decisions are captured
- [ ] RECENT.md stays under 500 lines
- [ ] MEMORY.md index is navigable
- [ ] User can find information later via search
- [ ] No secrets or PII in committed files
- [ ] Log shows clear audit trail
- [ ] Recovery process works if something breaks

## Future Enhancements (v1+)

- Vector embeddings for semantic search
- Cross-project memory sharing
- Automated importance scoring
- Memory decay (fade old entries)
- Conflict resolution UI
- Web dashboard for memory exploration
- Integration with external tools (Notion, Obsidian)
