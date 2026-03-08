# Context Recall Terminology Notes

Purpose: capture terminology and framing for the tiered memory system as we refine it.

Status: historical notes plus current terminology. The shipped architecture is now
workspace context -> collectors (`opencode`, `task`, `now`) -> consolidation -> retrieval.

## Intent

- Help the agent recall prior work, decisions, and context across sessions.
- Support questions like: "When did we last touch this?" or "What did we decide last time?"
- Emphasize continuity and recall rather than authoritative truth.

## Non-goals

- Not a canonical source of truth or single system state.
- Not guaranteed to be complete, current, or conflict-free.
- Not a replacement for tasks, git history, or config files.

## Working Terminology

Preferred umbrella phrase:

- Context Recall System

Alternates (keep in mind for docs/UI):

- Working Memory
- Project Memory
- Session Memory
- Continuity Notes
- Context Ledger

## Tier Mapping (framing)

- NOW: live session transcript (short-term recall)
- RECENT: last few sessions summary (continuity snapshot)
- MEMORY: long-term curated recall (historical context)

## Retrieval Layer

Current implementation:

- Materialized memory search across NOW, RECENT, and MEMORY files.
- Recall-summary search over `.continuum/recall/opencode/` using local BM25 and
  tf-idf semantic fallback.
- Unified retrieval exposed through `continuum memory search`.

Notes:

- Retrieval is intentionally local and workspace-scoped.
- Recall summaries are now one collector source, not a separate primary CLI.
- `continuum memory recall ...` is compatibility-only for import and recall-only search.

## OpenCode Data Sources (Capture Layer)

Relevant local paths (from data scan):

- `~/.local/share/opencode/storage/session/**` - session metadata (ids, titles, timestamps)
- `~/.local/share/opencode/storage/message/**` - message envelopes (role, created time)
- `~/.local/share/opencode/storage/part/**` - message parts (text content)
- `~/.local/share/opencode/storage/project/**` - project metadata (worktree path mapping)
- `~/.local/share/opencode/tool-output/**` - tool outputs (large/noisy; optional)

Implications:

- We can treat OpenCode storage as the raw conversation source of truth.
- Session reconstruction is possible by ordering messages by `time.created` and joining parts.
- Project scoping is doable via `project.worktree` matching the repo path.

Integration sketch (collector pipeline):

- Read OpenCode session + message + part JSON for the current project.
- Emit one Markdown recall doc per session into `.continuum/recall/opencode/`.
- Include frontmatter with session_id, project_id, directory, timestamps, message_count.
- Make summaries searchable through unified memory retrieval.

## OpenCode Storage Findings (2026-02-12)

Mapping:

- Project ID is derived by scanning `storage/project/*.json` for matching `worktree`.
- Sessions live under `storage/session/<projectID>/`.

Session schema (common fields):

- `id`, `slug`, `version`, `projectID`, `directory`, `title`
- `time.created`, `time.updated`
- `summary.additions`, `summary.deletions`, `summary.files`
- Optional: `parentID`, `permission`

Message schema (common fields):

- `id`, `sessionID`, `role`, `time.created`
- `summary.title` on user messages
- Assistant telemetry: `providerID`, `modelID`, `agent`, `mode`, `tokens`, `cost`
- Assistant `parentID` links back to user prompt

Part schema (common fields):

- `id`, `sessionID`, `messageID`, `type`
- Text parts include `text` with `time.start`/`time.end`
- Tool parts include `callID`, `tool`, `state.status`, `state.time`

Ordering rules:

- Sessions: `time.created` (start), `time.updated` (end)
- Messages: order by `time.created`
- Parts: order by `time.start` / `state.time.start`; fallback to part ID sort

Known gaps:

- `storage/session_diff/*` often empty; likely low recall value
- Tool output files are noisy and not clearly linked to `callID`

## Decisions

-

## Open Questions (Checklist)

- [ ] Keep CLI command as `memory`, but describe as "context recall"?
- [ ] Rename docs headers ("Memory System" -> "Context Recall System")?
- [ ] Add a structured "recall index" separate from narrative summaries?
