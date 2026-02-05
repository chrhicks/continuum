import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MEMORY_DIR } from "./paths.ts";
import { parseFrontmatter } from "../utils/frontmatter.ts";

export type MemorySearchTier = "NOW" | "RECENT" | "MEMORY" | "all";

export type MemorySearchMatch = {
  filePath: string;
  lineNumber: number;
  lineText: string;
};

export type MemorySearchResult = {
  matches: MemorySearchMatch[];
  filesSearched: number;
};

export function searchMemory(
  query: string,
  tier: MemorySearchTier = "all",
  tags: string[] = []
): MemorySearchResult {
  if (!existsSync(MEMORY_DIR)) {
    return { matches: [], filesSearched: 0 };
  }

  const files = listMemoryFiles(tier);
  const normalizedTags = normalizeTags(tags);
  const normalizedQuery = query.toLowerCase();
  const matches: MemorySearchMatch[] = [];
  let filesSearched = 0;

  for (const filePath of files) {
    if (!existsSync(filePath)) {
      continue;
    }
    const content = readFileSync(filePath, "utf-8");
    filesSearched += 1;
    if (normalizedTags.length > 0) {
      const { frontmatter } = parseFrontmatter(content);
      const fileTags = normalizeTags(frontmatter.tags);
      if (!hasAllTags(fileTags, normalizedTags)) {
        continue;
      }
    }
    const lines = content.split("\n");
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(normalizedQuery)) {
        matches.push({ filePath, lineNumber: index + 1, lineText: line });
      }
    });
  }

  return { matches, filesSearched };
}

function listMemoryFiles(tier: MemorySearchTier): string[] {
  const entries = readdirSync(MEMORY_DIR);
  const allFiles = entries
    .filter((file) => isMemoryFile(file))
    .map((file) => join(MEMORY_DIR, file));

  if (tier === "all") {
    return allFiles.sort();
  }

  return allFiles
    .filter((file) => matchesTier(file, tier))
    .sort();
}

function isMemoryFile(fileName: string): boolean {
  if (fileName === "RECENT.md" || fileName === "MEMORY.md") {
    return true;
  }
  if (/^NOW-.*\.md$/.test(fileName)) {
    return true;
  }
  return /^MEMORY-.*\.md$/.test(fileName);
}

function matchesTier(filePath: string, tier: Exclude<MemorySearchTier, "all">): boolean {
  const fileName = filePath.split("/").pop() ?? "";
  if (tier === "NOW") {
    return /^NOW-.*\.md$/.test(fileName);
  }
  if (tier === "RECENT") {
    return fileName === "RECENT.md";
  }
  return fileName === "MEMORY.md" || /^MEMORY-.*\.md$/.test(fileName);
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((tag) => String(tag).trim()).filter((tag) => tag.length > 0);
}

function hasAllTags(fileTags: string[], requiredTags: string[]): boolean {
  return requiredTags.every((tag) => fileTags.includes(tag));
}
