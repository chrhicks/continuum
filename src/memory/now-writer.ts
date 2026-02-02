import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { memoryPath } from "./paths.ts";
import { parseFrontmatter, replaceFrontmatter } from "../utils/frontmatter.ts";
import { resolveCurrentSessionPath } from "./session.ts";

const LOCK_FILE = memoryPath(".now.lock");
const MAX_LOCK_RETRIES = 3;
const LOCK_RETRY_DELAY_MS = 200;

type AppendOptions = {
  tags?: string[];
};

export async function appendUserMessage(message: string, options: AppendOptions = {}): Promise<void> {
  await appendEntry(`## User: ${message}`, options);
}

export async function appendAgentMessage(message: string, options: AppendOptions = {}): Promise<void> {
  await appendEntry(`## Agent: ${message}`, options);
}

export async function appendToolCall(toolName: string, summary?: string): Promise<void> {
  const details = summary ? ` - ${summary}` : "";
  await appendEntry(`[Tool: ${toolName}${details}]`);
}

async function appendEntry(entry: string, options: AppendOptions = {}): Promise<void> {
  const filePath = resolveCurrentSessionPath();
  if (!filePath) {
    throw new Error("No active NOW session found.");
  }

  await withLock(async () => {
    const content = readFileSync(filePath, "utf-8");
    const { frontmatter, keys } = parseFrontmatter(content);
    const updatedTags = mergeTags(frontmatter.tags, options.tags);
    const updatedFrontmatter = {
      ...frontmatter,
      tags: updatedTags
    };

    const normalizedEntry = entry.trim();
    const suffix = content.endsWith("\n") ? "" : "\n";
    const updatedBody = `${content}${suffix}\n${normalizedEntry}\n`;
    const replaced = replaceFrontmatter(updatedBody, updatedFrontmatter, keys.length ? keys : undefined);
    writeFileSync(filePath, replaced, "utf-8");
  });
}

async function withLock(action: () => void | Promise<void>): Promise<void> {
  let attempt = 0;
  while (attempt < MAX_LOCK_RETRIES) {
    try {
      const descriptor = openSync(LOCK_FILE, "wx");
      closeSync(descriptor);
      try {
        await action();
      } finally {
        unlinkSync(LOCK_FILE);
      }
      return;
    } catch {
      attempt += 1;
      if (attempt >= MAX_LOCK_RETRIES) {
        throw new Error("NOW file is locked. Try again shortly.");
      }
      await sleep(LOCK_RETRY_DELAY_MS);
    }
  }
}

function mergeTags(current: unknown, incoming?: string[]): string[] {
  const currentTags = Array.isArray(current) ? current.map(String) : [];
  const incomingTags = incoming ? incoming.map(String) : [];
  const merged = new Set([...currentTags, ...incomingTags].filter((tag) => tag.length > 0));
  return Array.from(merged);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
