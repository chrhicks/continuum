import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getStatus } from "../src/memory/status";

function withTempCwd(run: () => void): void {
  const root = mkdtempSync(join(tmpdir(), "continuum-cli-"));
  const previous = process.cwd();
  try {
    process.chdir(root);
    run();
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
}

describe("memory status sizes", () => {
  test("reports total memory and NOW sizes", () => {
    withTempCwd(() => {
      const memoryDir = join(process.cwd(), ".continuum", "memory");
      mkdirSync(memoryDir, { recursive: true });

      const nowFileName = "NOW-2026-02-02T16-00-00.md";
      const nowPath = join(memoryDir, nowFileName);
      const recentPath = join(memoryDir, "RECENT.md");
      const currentPath = join(memoryDir, ".current");

      writeFileSync(nowPath, "hello", "utf-8");
      writeFileSync(recentPath, "abc", "utf-8");
      writeFileSync(currentPath, nowFileName, "utf-8");

      const expectedTotal = [nowPath, recentPath, currentPath]
        .map((path) => statSync(path).size)
        .reduce((sum, size) => sum + size, 0);

      const status = getStatus();

      expect(status.nowBytes).toBe(statSync(nowPath).size);
      expect(status.memoryBytes).toBe(expectedTotal);
    });
  });
});
