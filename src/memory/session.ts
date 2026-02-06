import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { randomUUID } from "node:crypto";
import { initMemory } from "./init";
import { memoryPath } from "./paths";
import { parseFrontmatter, replaceFrontmatter } from "../utils/frontmatter";
import { withMemoryLock } from "./lock";

const CURRENT_SESSION_FILE = memoryPath(".current");

export type SessionInfo = {
  filePath: string;
  sessionId: string;
};

export function startSession(): SessionInfo {
  return withMemoryLock(() => {
    initMemory();

    const now = new Date();
    const parentSession = resolveParentSessionId();
    const sessionId = `sess_${randomUUID().replace(/-/g, "")}`;
    const timestampStart = now.toISOString();
    const filename = `NOW-${formatTimestampForFilename(now)}-${formatSessionSuffix(sessionId)}.md`;
    const filePath = memoryPath(filename);

    const frontmatter = {
      session_id: sessionId,
      timestamp_start: timestampStart,
      timestamp_end: null,
      duration_minutes: null,
      project_path: process.cwd(),
      tags: [],
      parent_session: parentSession,
      related_tasks: [],
      memory_type: "NOW"
    };

    const header = `# Session: ${sessionId} - ${formatTimestampForHeader(now)}`;
    const content = `${buildFrontmatter(frontmatter)}\n\n${header}\n\n`;
    writeFileSync(filePath, content, "utf-8");
    writeFileSync(CURRENT_SESSION_FILE, filename, "utf-8");

    return { filePath, sessionId };
  });
}

export function endSession(): string {
  return withMemoryLock(() => {
    const filePath = resolveCurrentSessionPath({ allowFallback: true });
    if (!filePath) {
      throw new Error("No active NOW session found.");
    }

    const content = readFileSync(filePath, "utf-8");
    const { frontmatter, keys } = parseFrontmatter(content);
    const timestampStart = frontmatter.timestamp_start ? String(frontmatter.timestamp_start) : null;
    const timestampEnd = new Date().toISOString();
    let durationMinutes: number | null = null;
    if (timestampStart) {
      const parsedStart = Date.parse(timestampStart);
      if (Number.isNaN(parsedStart)) {
        console.warn("Invalid timestamp_start in NOW frontmatter. Duration set to null.");
      } else {
        durationMinutes = Math.round((Date.parse(timestampEnd) - parsedStart) / 60000);
      }
    }

    const updated = {
      ...frontmatter,
      timestamp_end: timestampEnd,
      duration_minutes: durationMinutes
    };

    const replaced = replaceFrontmatter(content, updated, keys.length ? keys : undefined);
    writeFileSync(filePath, replaced, "utf-8");
    if (existsSync(CURRENT_SESSION_FILE)) {
      unlinkSync(CURRENT_SESSION_FILE);
    }
    return filePath;
  });
}

export function getCurrentSessionPath(): string | null {
  if (!existsSync(CURRENT_SESSION_FILE)) {
    return null;
  }
  const filename = readFileSync(CURRENT_SESSION_FILE, "utf-8").trim();
  if (!filename) {
    return null;
  }
  return memoryPath(filename);
}

export function resolveCurrentSessionPath(options: { allowFallback: boolean } = { allowFallback: false }): string | null {
  const pointerPath = getCurrentSessionPath();
  if (pointerPath) {
    return pointerPath;
  }

  if (!options.allowFallback) {
    return null;
  }

  const candidates = readdirSync(memoryPath("."))
    .filter((name) => name.startsWith("NOW-") && name.endsWith(".md"))
    .map((name) => ({
      name,
      path: memoryPath(name),
      mtime: statSync(memoryPath(name)).mtimeMs
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (candidates.length === 0) {
    return null;
  }

  return candidates[0].path;
}

function resolveParentSessionId(): string | null {
  const previousPath = resolveCurrentSessionPath({ allowFallback: true });
  if (!previousPath || !existsSync(previousPath)) {
    return null;
  }
  try {
    const content = readFileSync(previousPath, "utf-8");
    const { frontmatter } = parseFrontmatter(content);
    const sessionId = frontmatter.session_id ? String(frontmatter.session_id) : null;
    return sessionId && sessionId.length > 0 ? sessionId : null;
  } catch {
    return null;
  }
}

function formatTimestampForFilename(date: Date): string {
  const iso = date.toISOString();
  return iso.replace(/:/g, "-").slice(0, 19);
}

function formatSessionSuffix(sessionId: string): string {
  return sessionId.replace("sess_", "").slice(0, 6);
}

function formatTimestampForHeader(date: Date): string {
  const iso = date.toISOString();
  const [day, time] = iso.split("T");
  return `${day} ${time.slice(0, 5)} UTC`;
}

function buildFrontmatter(frontmatter: Record<string, unknown>): string {
  const order = [
    "session_id",
    "timestamp_start",
    "timestamp_end",
    "duration_minutes",
    "project_path",
    "tags",
    "parent_session",
    "related_tasks",
    "memory_type"
  ];
  const lines = order.map((key) => `${key}: ${formatValue(frontmatter[key])}`);
  return `---\n${lines.join("\n")}\n---`;
}

function formatValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatValue(item)).join(", ")}]`;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return String(value);
}
