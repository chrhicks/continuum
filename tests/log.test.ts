import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readConsolidationLog } from "../src/memory/log";

function withTempMemory(run: (memoryDir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "continuum-log-"));
  const memoryDir = join(root, ".continuum", "memory");
  mkdirSync(memoryDir, { recursive: true });
  try {
    run(memoryDir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("consolidation log reader", () => {
  test("returns empty result when log missing", () => {
    withTempMemory((memoryDir) => {
      const result = readConsolidationLog({ memoryDir });
      expect(result.totalLines).toBe(0);
      expect(result.lines).toHaveLength(0);
      expect(result.filePath.endsWith("consolidation.log")).toBe(true);
    });
  });

  test("tails log lines when requested", () => {
    withTempMemory((memoryDir) => {
      const logPath = join(memoryDir, "consolidation.log");
      const content = ["line-1", "line-2", "line-3", "line-4", "line-5", "line-6"].join("\n") + "\n";
      writeFileSync(logPath, content, "utf-8");

      const result = readConsolidationLog({ memoryDir, tail: 3 });
      expect(result.totalLines).toBe(6);
      expect(result.lines).toEqual(["line-4", "line-5", "line-6"]);
      expect(result.truncated).toBe(true);
    });
  });
});
