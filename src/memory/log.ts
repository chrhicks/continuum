import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MEMORY_DIR } from "./paths.ts";

export type ConsolidationLogResult = {
  filePath: string;
  lines: string[];
  totalLines: number;
  truncated: boolean;
};

export function readConsolidationLog(options: { tail?: number; memoryDir?: string } = {}): ConsolidationLogResult {
  const memoryDir = options.memoryDir ?? MEMORY_DIR;
  const filePath = join(memoryDir, "consolidation.log");
  if (!existsSync(filePath)) {
    return { filePath, lines: [], totalLines: 0, truncated: false };
  }

  const content = readFileSync(filePath, "utf-8");
  const trimmed = content.trimEnd();
  if (!trimmed) {
    return { filePath, lines: [], totalLines: 0, truncated: false };
  }

  const lines = trimmed.split("\n");
  const totalLines = lines.length;
  const tail = options.tail;
  if (tail === undefined || totalLines <= tail || tail <= 0) {
    return { filePath, lines, totalLines, truncated: false };
  }

  return {
    filePath,
    lines: lines.slice(totalLines - tail),
    totalLines,
    truncated: true
  };
}
