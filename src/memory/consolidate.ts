import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { initMemory } from "./init.ts";
import { MEMORY_DIR, memoryPath } from "./paths.ts";
import { getMemoryConfig } from "./config.ts";
import { parseFrontmatter, replaceFrontmatter } from "../utils/frontmatter.ts";
import { resolveCurrentSessionPath } from "./session.ts";
import { withMemoryLock } from "./lock.ts";

type ConsolidationPreview = {
  recentLines: number;
  memoryLines: number;
  memoryIndexLines: number;
  logLines: number;
  nowLines: number;
};

type ConsolidationOutput = {
  recentPath: string;
  memoryPath: string;
  memoryIndexPath: string;
  logPath: string;
  nowPath: string;
  dryRun: boolean;
  preview?: ConsolidationPreview;
};

const NOW_RETENTION_DAYS = 3;
const LOG_ROTATION_LINES = 1000;

export function consolidateNow(
  options: { nowPath?: string; dryRun?: boolean; skipNowCleanup?: boolean } = {}
): ConsolidationOutput {
  const dryRun = options.dryRun ?? false;
  const runConsolidation = (): ConsolidationOutput => {
    if (!dryRun) {
      initMemory();
    } else if (!existsSync(MEMORY_DIR)) {
      throw new Error("Memory directory not initialized. Run: continuum memory init");
    }
    const config = getMemoryConfig();
    const nowPath = options.nowPath ?? resolveCurrentSessionPath({ allowFallback: true });
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

    const decisions = extractMarkers(body, /@decision\b[:\s-]*(.+)/i);
    const discoveries = extractMarkers(body, /@discovery\b[:\s-]*(.+)/i);
    const patterns = extractMarkers(body, /@pattern\b[:\s-]*(.+)/i);
    const focus = resolveFocus(body, decisions, discoveries, patterns);
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

    const updatedRecent = upsertRecent(recentPath, recentEntry, {
      maxSessions: config.recent_session_count,
      maxLines: config.recent_max_lines
    });

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
      hasPatterns: patterns.length > 0,
      sections: config.memory_sections
    });

    const updatedFrontmatter = {
      ...frontmatter,
      duration_minutes: durationMinutes
    };
    const clearedNow = buildClearedNowContent(updatedFrontmatter, keys, body);
    const updatedNow = clearedNow;

    const logEntry = buildLogEntry({
      nowFile: nowPath,
      memoryFile: memoryFilePath,
      recentPath,
      decisions: decisions.length,
      discoveries: discoveries.length,
      patterns: patterns.length
    });

    if (!dryRun) {
      const logUpdate = buildUpdatedLog(logPath, logEntry);
      writeFilesAtomically([
        { path: recentPath, content: updatedRecent },
        { path: memoryFilePath, content: updatedMemory },
        { path: memoryIndexPath, content: updatedIndex },
        { path: nowPath, content: updatedNow },
        { path: logPath, content: logUpdate.content, rotateExistingTo: logUpdate.rotateExistingTo }
      ]);
      if (!options.skipNowCleanup) {
        cleanupOldNowFiles(nowPath, NOW_RETENTION_DAYS);
      }
    }

    const preview: ConsolidationPreview = {
      recentLines: countLines(updatedRecent),
      memoryLines: countLines(updatedMemory),
      memoryIndexLines: countLines(updatedIndex),
      logLines: countLines(logEntry.entry),
      nowLines: countLines(updatedNow)
    };

    return {
      recentPath,
      memoryPath: memoryFilePath,
      memoryIndexPath,
      logPath,
      nowPath,
      dryRun,
      preview: dryRun ? preview : undefined
    };
  };

  if (dryRun) {
    return runConsolidation();
  }

  return withMemoryLock(runConsolidation);
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

function upsertRecent(
  path: string,
  entry: string,
  options: { maxSessions: number; maxLines: number }
): string {
  const maxSessions = Math.max(1, options.maxSessions);
  const header = `# RECENT - Last ${maxSessions} Sessions`;
  if (!existsSync(path)) {
    return `${header}\n\n${entry}\n`;
  }
  const content = readFileSync(path, "utf-8").trim();
  const lines = content.split("\n");
  const existingEntries = extractRecentEntries(lines);
  const allEntries = dedupeEntriesByAnchor([entry, ...existingEntries]).slice(0, maxSessions);
  return buildRecentContent(header, allEntries, options.maxLines);
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

function buildRecentContent(header: string, entries: string[], maxLines: number): string {
  let currentEntries = entries.slice();
  let content = `${header}\n\n${currentEntries.join("\n\n---\n\n")}\n`;
  if (maxLines <= 0) {
    return content;
  }

  while (content.split("\n").length > maxLines && currentEntries.length > 1) {
    currentEntries = currentEntries.slice(0, currentEntries.length - 1);
    content = `${header}\n\n${currentEntries.join("\n\n---\n\n")}\n`;
  }
  return content;
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

function extractAnchorFromEntry(entry: string): string | null {
  const match = entry.match(/#([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

function upsertMemoryIndex(
  path: string,
  options: {
    entry: string;
    hasDecisions: boolean;
    hasDiscoveries: boolean;
    hasPatterns: boolean;
    sections: string[];
  }
): string {
  const defaultContent = buildDefaultIndexContent(options.sections);

  const content = existsSync(path) ? readFileSync(path, "utf-8") : defaultContent;
  let updated = dedupeIndexEntries(content);

  const indexSections = resolveIndexSections(options.sections);
  if (options.hasDecisions) {
    updated = insertEntryInSection(updated, indexSections.decisions, options.entry);
  } else if (options.hasDiscoveries) {
    updated = insertEntryInSection(updated, indexSections.discoveries, options.entry);
  } else if (options.hasPatterns) {
    updated = insertEntryInSection(updated, indexSections.patterns, options.entry);
  } else {
    updated = insertEntryInSection(updated, indexSections.sessions, options.entry);
  }

  return updated.trimEnd() + "\n";
}

function dedupeIndexEntries(content: string): string {
  const lines = content.split("\n");
  const output: string[] = [];
  const seenBySection = new Map<string, Set<string>>();
  let currentSection: string | null = null;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      currentSection = line.replace(/^##\s+/, "").trim();
      output.push(line);
      continue;
    }

    if (currentSection && line.startsWith("- ")) {
      const key = extractAnchorFromEntry(line) ?? line;
      let seen = seenBySection.get(currentSection);
      if (!seen) {
        seen = new Set();
        seenBySection.set(currentSection, seen);
      }
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
    }

    output.push(line);
  }

  return output.join("\n");
}

function buildDefaultIndexContent(sections: string[]): string {
  const lines: string[] = ["# Long-term Memory Index", ""];
  for (const section of sections) {
    lines.push(`## ${section}`, "");
  }
  return lines.join("\n");
}

function resolveIndexSections(sections: string[]): {
  decisions: string;
  discoveries: string;
  patterns: string;
  sessions: string;
} {
  return {
    decisions: sections[0] ?? "Architecture Decisions",
    discoveries: sections[1] ?? "Technical Discoveries",
    patterns: sections[2] ?? "Development Patterns",
    sessions: sections.find((section) => section === "Sessions") ?? "Sessions"
  };
}

export function insertEntryInSection(content: string, section: string, entry: string): string {
  const lines = content.split("\n");
  const header = `## ${section}`;
  let index = lines.findIndex((line) => line.trim() === header);
  if (index === -1) {
    return content.trimEnd() + `\n${header}\n${entry}\n`;
  }

  let scanIndex = index + 1;
  while (scanIndex < lines.length && lines[scanIndex].trim() === "") {
    scanIndex += 1;
  }
  const insertIndex = scanIndex;
  const entryAnchor = extractAnchorFromEntry(entry);
  while (scanIndex < lines.length && !lines[scanIndex].startsWith("## ")) {
    if (lines[scanIndex].startsWith("- ")) {
      if (entryAnchor) {
        const existingAnchor = extractAnchorFromEntry(lines[scanIndex]);
        if (existingAnchor === entryAnchor) {
          return lines.join("\n");
        }
      } else if (lines[scanIndex] === entry) {
        return lines.join("\n");
      }
    }
    scanIndex += 1;
  }
  lines.splice(insertIndex, 0, entry);
  return lines.join("\n");
}

export function dedupeEntriesByAnchor(entries: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const entry of entries) {
    const anchor = extractAnchorFromEntry(entry);
    const key = anchor ?? entry;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(entry);
  }
  return output;
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

function buildClearedNowContent(frontmatter: Record<string, unknown>, keys: string[], body: string): string {
  const header = extractSessionHeader(body);
  const clearedBody = `${header}\n\n`;
  return replaceFrontmatter(clearedBody, frontmatter, keys.length ? keys : undefined);
}

function extractSessionHeader(body: string): string {
  const lines = body.split("\n");
  for (const line of lines) {
    if (line.startsWith("# Session: ")) {
      return line;
    }
  }
  return "# Session: unknown";
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

function resolveFocus(
  body: string,
  decisions: string[],
  discoveries: string[],
  patterns: string[]
): string {
  const userFocus = extractFocus(body);
  if (userFocus) {
    return userFocus;
  }
  const markerFocus = decisions[0] ?? discoveries[0] ?? patterns[0];
  if (markerFocus) {
    return markerFocus;
  }
  return "No markers provided";
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

function buildLogEntry(options: {
  nowFile: string;
  memoryFile: string;
  recentPath: string;
  decisions: number;
  discoveries: number;
  patterns: number;
}): { entry: string; timestamp: string } {
  const timestamp = new Date().toISOString().replace("T", " ").replace("Z", " UTC");
  const entry = [
    `[${timestamp}] ACTION: Consolidate NOW→RECENT→MEMORY (Marker-based)`,
    "  Files:",
    `    - ${options.nowFile}`,
    `    - ${options.recentPath}`,
    `    - ${options.memoryFile}`,
    `  Extracted: ${options.decisions} decisions, ${options.discoveries} discoveries, ${options.patterns} patterns`,
    ""
  ].join("\n");
  return { entry, timestamp };
}

function buildUpdatedLog(
  path: string,
  logEntry: { entry: string; timestamp: string }
): { content: string; rotateExistingTo?: string } {
  let existing = "";
  let rotateExistingTo: string | undefined;
  if (existsSync(path)) {
    const content = readFileSync(path, "utf-8");
    const lineCount = content.split("\n").length;
    if (lineCount > LOG_ROTATION_LINES) {
      rotateExistingTo = `${path}.old`;
    } else {
      existing = content;
    }
  }
  return { content: existing + logEntry.entry + "\n", rotateExistingTo };
}

type AtomicWriteTarget = {
  path: string;
  content: string;
  rotateExistingTo?: string;
};

function writeFilesAtomically(targets: AtomicWriteTarget[]): void {
  const tempPaths = new Map<string, string>();
  const backups: { path: string; backupPath: string }[] = [];
  const rotations: { from: string; to: string }[] = [];

  try {
    for (const target of targets) {
      const tempPath = `${target.path}.tmp-${randomSuffix()}`;
      writeFileSync(tempPath, target.content, "utf-8");
      tempPaths.set(target.path, tempPath);
    }

    for (const target of targets) {
      if (!target.rotateExistingTo || !existsSync(target.path)) {
        continue;
      }
      if (existsSync(target.rotateExistingTo)) {
        rmSync(target.rotateExistingTo);
      }
      renameSync(target.path, target.rotateExistingTo);
      rotations.push({ from: target.rotateExistingTo, to: target.path });
    }

    for (const target of targets) {
      if (!existsSync(target.path)) {
        continue;
      }
      const backupPath = `${target.path}.bak`;
      if (existsSync(backupPath)) {
        const rotatedBackup = `${backupPath}.old`;
        if (existsSync(rotatedBackup)) {
          rmSync(rotatedBackup);
        }
        renameSync(backupPath, rotatedBackup);
      }
      const existingContent = readFileSync(target.path, "utf-8");
      writeFileSync(backupPath, existingContent, "utf-8");
      backups.push({ path: target.path, backupPath });
    }

    for (const target of targets) {
      const tempPath = tempPaths.get(target.path);
      if (!tempPath) {
        continue;
      }
      renameSync(tempPath, target.path);
    }
  } catch (error) {
    for (const tempPath of tempPaths.values()) {
      if (existsSync(tempPath)) {
        rmSync(tempPath);
      }
    }

    for (const { path, backupPath } of backups) {
      if (!existsSync(backupPath)) {
        continue;
      }
      const backupContent = readFileSync(backupPath, "utf-8");
      writeFileSync(path, backupContent, "utf-8");
    }

    for (const rotation of rotations) {
      if (existsSync(rotation.from) && !existsSync(rotation.to)) {
        renameSync(rotation.from, rotation.to);
      }
    }

    throw error;
  }
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

function countLines(content: string): number {
  if (!content) {
    return 0;
  }
  return content.split("\n").length;
}

function cleanupOldNowFiles(activeNowPath: string, retentionDays: number): string[] {
  if (!existsSync(MEMORY_DIR)) {
    return [];
  }

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const activePath = resolve(activeNowPath);
  const removed: string[] = [];

  for (const fileName of readdirSync(MEMORY_DIR)) {
    if (!/^NOW-.*\.md$/.test(fileName)) {
      continue;
    }
    const filePath = join(MEMORY_DIR, fileName);
    if (resolve(filePath) === activePath) {
      continue;
    }
    const stats = statSync(filePath);
    if (stats.mtimeMs < cutoff) {
      rmSync(filePath);
      removed.push(filePath);
    }
  }

  return removed;
}
