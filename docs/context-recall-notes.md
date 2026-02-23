# Context Recall Terminology Notes

Purpose: capture terminology and framing for the tiered memory system as we refine it.

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

## Candidate Tool: qmd (Recall Layer)

What it is:

- Local hybrid search engine for markdown (BM25 + vector + reranking).
- Designed for agent use with JSON output and MCP server.

Why it fits:

- Treats memory as markdown docs, supports natural language queries.
- Strong recall quality via hybrid retrieval + reranking.
- Local/private; no external services required.

Gaps to account for:

- It does not create or consolidate memory; it only indexes what we write.
- Recency logic is not explicit; timestamps/metadata must be encoded in docs.
- No native notion of decisions/discoveries unless we structure notes.

Integration ideas:

- Index `.continuum/memory/` as a qmd collection.
- Add frontmatter or headings with dates/tags to improve recall.
- Use `qmd query` or MCP tool `qmd_deep_search` as the recall entrypoint.

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

Integration sketch (recall pipeline):

- Read OpenCode session + message + part JSON for the current project.
- Emit one Markdown recall doc per session into `.continuum/recall/opencode/`.
- Include frontmatter with session_id, project_id, directory, timestamps, message_count.
- Index `.continuum/recall/opencode/` with qmd for recall queries.

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
