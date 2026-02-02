import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { initMemory } from "./init.ts";
import { memoryPath } from "./paths.ts";
import { parseFrontmatter, replaceFrontmatter } from "../utils/frontmatter.ts";
import { resolveCurrentSessionPath } from "./session.ts";

type ConsolidationOutput = {
  recentPath: string;
  memoryPath: string;
  memoryIndexPath: string;
  logPath: string;
};

export function consolidateNow(): ConsolidationOutput {
  initMemory();
  const nowPath = resolveCurrentSessionPath({ allowFallback: true });
  if (!nowPath) {
    throw new Error("No active NOW session found.");
  }

  const nowContent = readFileSync(nowPath, "utf-8");
  const { frontmatter, body, keys } = parseFrontmatter(nowContent);

  const sessionId = String(frontmatter.session_id ?? "unknown");
  const timestampStart = frontmatter.timestamp_start
    ? new Date(String(frontmatter.timestamp_start))
    : new Date();
  const timestampEnd = frontmatter.timestamp_end
    ? new Date(String(frontmatter.timestamp_end))
    : new Date();
  const durationMinutes = frontmatter.duration_minutes
    ? Number(frontmatter.duration_minutes)
    : Math.max(1, Math.round((timestampEnd.getTime() - timestampStart.getTime()) / 60000));
  const tags = normalizeTags(frontmatter.tags);

  const focus = extractFocus(body) ?? "Session work";
  const decisions = extractMarkers(body, /@decision\b[:\s-]*(.+)/i);
  const discoveries = extractMarkers(body, /@discovery\b[:\s-]*(.+)/i);
  const patterns = extractMarkers(body, /@pattern\b[:\s-]*(.+)/i);
  const tasks = extractTasks(body);
  const files = extractFiles(body);

  const dateStamp = formatDate(timestampStart);
  const displayTime = formatDisplayTime(timestampStart);
  const anchorTime = formatAnchorTime(timestampStart);
  const sessionAnchor = `session-${dateStamp}-${anchorTime}-${sessionId}`.replace(/[^a-zA-Z0-9_-]/g, "");
  const memoryFilePath = memoryPath(`MEMORY-${dateStamp}.md`);
  const memoryIndexPath = memoryPath("MEMORY.md");
  const recentPath = memoryPath("RECENT.md");
  const logPath = memoryPath("consolidation.log");

  const recentEntry = buildRecentEntry({
    dateStamp,
    timeStamp: displayTime,
    durationMinutes,
    focus,
    decisions,
    discoveries,
    patterns,
    tasks,
    files,
    memoryFileName: `MEMORY-${dateStamp}.md`,
    anchor: sessionAnchor
  });

  const updatedRecent = upsertRecent(recentPath, recentEntry);
  writeFileSync(recentPath, updatedRecent, "utf-8");

  const memorySection = buildMemorySection({
    sessionId,
    dateStamp,
    timeStamp: displayTime,
    focus,
    decisions,
    discoveries,
    patterns,
    tasks,
    files,
    anchor: sessionAnchor
  });
  const updatedMemory = upsertMemoryFile(memoryFilePath, {
    sessionId,
    tags,
    section: memorySection
  });
  writeFileSync(memoryFilePath, updatedMemory, "utf-8");

  const indexEntry = buildIndexEntry({
    dateStamp,
    timeStamp: displayTime,
    focus,
    memoryFileName: `MEMORY-${dateStamp}.md`,
    anchor: sessionAnchor
  });
  const updatedIndex = upsertMemoryIndex(memoryIndexPath, {
    entry: indexEntry,
    hasDecisions: decisions.length > 0,
    hasDiscoveries: discoveries.length > 0,
    hasPatterns: patterns.length > 0
  });
  writeFileSync(memoryIndexPath, updatedIndex, "utf-8");

  const updatedFrontmatter = {
    ...frontmatter,
    duration_minutes: durationMinutes
  };
  const updatedNow = replaceFrontmatter(nowContent, updatedFrontmatter, keys.length ? keys : undefined);
  writeFileSync(nowPath, updatedNow, "utf-8");

  appendLog(logPath, {
    nowFile: nowPath,
    memoryFile: memoryFilePath,
    recentPath,
    decisions: decisions.length,
    discoveries: discoveries.length,
    patterns: patterns.length
  });

  return { recentPath, memoryPath: memoryFilePath, memoryIndexPath, logPath };
}

function buildRecentEntry(options: {
  dateStamp: string;
  timeStamp: string;
  durationMinutes: number;
  focus: string;
  decisions: string[];
  discoveries: string[];
  patterns: string[];
  tasks: string[];
  files: string[];
  memoryFileName: string;
  anchor: string;
}): string {
  const duration = formatDuration(options.durationMinutes);
  const lines: string[] = [];
  lines.push(`## Session ${options.dateStamp} ${options.timeStamp} (${duration})`);
  lines.push("");
  lines.push(`**Focus**: ${options.focus}`);
  if (options.decisions.length > 0) {
    lines.push("");
    lines.push("**Key Decisions**:");
    lines.push(...options.decisions.map((item) => `- ${item}`));
  }
  if (options.discoveries.length > 0) {
    lines.push("");
    lines.push("**Discoveries**:");
    lines.push(...options.discoveries.map((item) => `- ${item}`));
  }
  if (options.patterns.length > 0) {
    lines.push("");
    lines.push("**Patterns**:");
    lines.push(...options.patterns.map((item) => `- ${item}`));
  }
  lines.push("");
  lines.push(`**Tasks**: ${options.tasks.length ? options.tasks.join(", ") : "none"}`);
  lines.push(`**Files**: ${options.files.length ? options.files.map((file) => `\`${file}\``).join(", ") : "none"}`);
  lines.push(
    `**Link**: [Full details](${options.memoryFileName}#${options.anchor})`
  );
  return lines.join("\n");
}

function upsertRecent(path: string, entry: string): string {
  const header = "# RECENT - Last 3 Sessions";
  if (!existsSync(path)) {
    return `${header}\n\n${entry}\n`;
  }
  const content = readFileSync(path, "utf-8").trim();
  const lines = content.split("\n");
  const existingEntries = extractRecentEntries(lines);
  const allEntries = [entry, ...existingEntries].slice(0, 3);
  return `${header}\n\n${allEntries.join("\n\n---\n\n")}\n`;
}

function extractRecentEntries(lines: string[]): string[] {
  const entries: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.startsWith("## Session ")) {
      if (current.length > 0) {
        entries.push(current.join("\n").trim());
      }
      current = [line];
      continue;
    }
    if (line.startsWith("# ")) {
      continue;
    }
    if (current.length > 0 && line.trim() === "---") {
      continue;
    }
    if (current.length > 0) {
      current.push(line);
    }
  }
  if (current.length > 0) {
    entries.push(current.join("\n").trim());
  }
  return entries;
}

function buildMemorySection(options: {
  sessionId: string;
  dateStamp: string;
  timeStamp: string;
  focus: string;
  decisions: string[];
  discoveries: string[];
  patterns: string[];
  tasks: string[];
  files: string[];
  anchor: string;
}): string {
  const lines: string[] = [];
  lines.push(`## Session ${options.dateStamp} ${options.timeStamp} UTC (${options.sessionId})`);
  lines.push(`<a name="${options.anchor}"></a>`);
  lines.push("");
  lines.push(`**Focus**: ${options.focus}`);
  if (options.decisions.length > 0) {
    lines.push("");
    lines.push("**Decisions**:");
    lines.push(...options.decisions.map((item) => `- ${item}`));
  }
  if (options.discoveries.length > 0) {
    lines.push("");
    lines.push("**Discoveries**:");
    lines.push(...options.discoveries.map((item) => `- ${item}`));
  }
  if (options.patterns.length > 0) {
    lines.push("");
    lines.push("**Patterns**:");
    lines.push(...options.patterns.map((item) => `- ${item}`));
  }
  lines.push("");
  lines.push(`**Tasks**: ${options.tasks.length ? options.tasks.join(", ") : "none"}`);
  lines.push(`**Files**: ${options.files.length ? options.files.map((file) => `\`${file}\``).join(", ") : "none"}`);
  return lines.join("\n");
}

function upsertMemoryFile(
  path: string,
  options: { sessionId: string; tags: string[]; section: string }
): string {
  const now = new Date().toISOString();
  if (!existsSync(path)) {
    const frontmatter = buildMemoryFrontmatter({
      consolidationDate: now,
      sessionIds: [options.sessionId],
      tags: options.tags,
      totalSessions: 1
    });
    return `${frontmatter}\n\n# Consolidated Memory\n\n${options.section}\n`;
  }

  const existing = readFileSync(path, "utf-8");
  const { frontmatter, body, keys } = parseFrontmatter(existing);
  const sessionIds = mergeUnique(frontmatter.source_sessions, [options.sessionId]);
  const tags = mergeUnique(frontmatter.tags, options.tags);
  const updatedFrontmatter = {
    ...frontmatter,
    consolidation_date: now,
    source_sessions: sessionIds,
    total_sessions_consolidated: sessionIds.length,
    tags
  };
  const updatedBody = body.trimEnd() + "\n\n" + options.section + "\n";
  return replaceFrontmatter(updatedBody, updatedFrontmatter, keys.length ? keys : undefined);
}

function buildMemoryFrontmatter(options: {
  consolidationDate: string;
  sessionIds: string[];
  totalSessions: number;
  tags: string[];
}): string {
  const lines = [
    `consolidation_date: ${options.consolidationDate}`,
    `source_sessions: [${options.sessionIds.join(", ")}]`,
    `total_sessions_consolidated: ${options.totalSessions}`,
    `tags: [${options.tags.join(", ")}]`,
    `consolidated_by: continuum-cli-v0.1`
  ];
  return `---\n${lines.join("\n")}\n---`;
}

function buildIndexEntry(options: {
  dateStamp: string;
  timeStamp: string;
  focus: string;
  memoryFileName: string;
  anchor: string;
}): string {
  const summary = options.focus.length > 80 ? `${options.focus.slice(0, 77)}...` : options.focus;
  return `- **[Session ${options.dateStamp} ${options.timeStamp}](${options.memoryFileName}#${options.anchor})** - ${summary}`;
}

function upsertMemoryIndex(
  path: string,
  options: { entry: string; hasDecisions: boolean; hasDiscoveries: boolean; hasPatterns: boolean }
): string {
  const defaultContent = [
    "# Long-term Memory Index",
    "",
    "## Architecture Decisions",
    "",
    "## Technical Discoveries",
    "",
    "## Development Patterns",
    "",
    "## Sessions",
    ""
  ].join("\n");

  const content = existsSync(path) ? readFileSync(path, "utf-8") : defaultContent;
  let updated = content;

  if (options.hasDecisions) {
    updated = insertEntryInSection(updated, "Architecture Decisions", options.entry);
  } else if (options.hasDiscoveries) {
    updated = insertEntryInSection(updated, "Technical Discoveries", options.entry);
  } else if (options.hasPatterns) {
    updated = insertEntryInSection(updated, "Development Patterns", options.entry);
  } else {
    updated = insertEntryInSection(updated, "Sessions", options.entry);
  }

  return updated.trimEnd() + "\n";
}

function insertEntryInSection(content: string, section: string, entry: string): string {
  const lines = content.split("\n");
  const header = `## ${section}`;
  let index = lines.findIndex((line) => line.trim() === header);
  if (index === -1) {
    return content.trimEnd() + `\n${header}\n${entry}\n`;
  }

  index += 1;
  while (index < lines.length && lines[index].startsWith("- ")) {
    index += 1;
  }
  lines.splice(index, 0, entry);
  return lines.join("\n");
}

function extractMarkers(body: string, pattern: RegExp): string[] {
  const lines = body.split("\n");
  const matches: string[] = [];
  for (const line of lines) {
    const match = line.match(pattern);
    if (match && match[1]) {
      matches.push(match[1].trim());
    }
  }
  return unique(matches);
}

function extractFocus(body: string): string | null {
  const lines = body.split("\n");
  for (const line of lines) {
    if (line.startsWith("## User: ")) {
      return line.replace("## User: ", "").trim();
    }
  }
  return null;
}

function extractTasks(body: string): string[] {
  const matches = body.match(/\btkt_[a-zA-Z0-9_-]+\b/g);
  return unique(matches ?? []);
}

function extractFiles(body: string): string[] {
  const matches = body.match(/\b[\w./-]+\.(ts|tsx|js|jsx|json|md|yaml|yml|sql|sh|go|py|rs)\b/g);
  return unique(matches ?? []);
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}

function mergeUnique(current: unknown, incoming: string[]): string[] {
  const currentArray = Array.isArray(current) ? current.map(String) : [];
  return unique([...currentArray, ...incoming]);
}

function normalizeTags(tags: unknown): string[] {
  return Array.isArray(tags) ? tags.map(String) : [];
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDisplayTime(date: Date): string {
  return date.toISOString().slice(11, 16);
}

function formatAnchorTime(date: Date): string {
  return date.toISOString().slice(11, 16).replace(/:/g, "-");
}

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (remaining === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remaining}m`;
}

function appendLog(
  path: string,
  options: { nowFile: string; memoryFile: string; recentPath: string; decisions: number; discoveries: number; patterns: number }
): void {
  const timestamp = new Date().toISOString().replace("T", " ").replace("Z", " UTC");
  const entry = [
    `[${timestamp}] ACTION: Consolidate NOW→RECENT→MEMORY (Marker-based)`,
    `  Files:`,
    `    - ${options.nowFile}`,
    `    - ${options.recentPath}`,
    `    - ${options.memoryFile}`,
    `  Extracted: ${options.decisions} decisions, ${options.discoveries} discoveries, ${options.patterns} patterns`,
    ""
  ].join("\n");
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : "";
  writeFileSync(path, existing + entry + "\n", "utf-8");
}
