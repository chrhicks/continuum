import { existsSync, readFileSync, statSync } from "node:fs";
import { memoryPath } from "./paths.ts";
import { getCurrentSessionPath } from "./session.ts";

export type MemoryStatus = {
  nowPath: string | null;
  nowLines: number;
  nowAgeMinutes: number | null;
  recentLines: number;
  lastConsolidation: string | null;
};

export function getStatus(): MemoryStatus {
  const nowPath = getCurrentSessionPath();
  let nowLines = 0;
  let nowAgeMinutes: number | null = null;

  if (nowPath && existsSync(nowPath)) {
    const content = readFileSync(nowPath, "utf-8");
    nowLines = content.split("\n").length;
    const stats = statSync(nowPath);
    nowAgeMinutes = Math.round((Date.now() - stats.mtimeMs) / 60000);
  }

  const recentPath = memoryPath("RECENT.md");
  const recentLines = existsSync(recentPath)
    ? readFileSync(recentPath, "utf-8").split("\n").length
    : 0;

  const logPath = memoryPath("consolidation.log");
  const lastConsolidation = existsSync(logPath) ? extractLastTimestamp(logPath) : null;

  return { nowPath, nowLines, nowAgeMinutes, recentLines, lastConsolidation };
}

function extractLastTimestamp(path: string): string | null {
  const lines = readFileSync(path, "utf-8").trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line.startsWith("[") && line.includes("]")) {
      return line.slice(1, line.indexOf("]"));
    }
  }
  return null;
}
