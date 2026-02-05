import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { appendUserMessage } from "../src/memory/now-writer";
import { startSession } from "../src/memory/session";

async function withTempCwd(run: () => Promise<void> | void): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "continuum-now-writer-"));
  const previous = process.cwd();
  try {
    process.chdir(root);
    await run();
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
}

describe("now writer", () => {
  test("clears stale lock files", async () => {
    await withTempCwd(async () => {
      const info = startSession();
      const lockPath = join(process.cwd(), ".continuum", "memory", ".now.lock");
      writeFileSync(lockPath, "lock", "utf-8");
      const staleTime = new Date(Date.now() - 120_000);
      utimesSync(lockPath, staleTime, staleTime);

      await appendUserMessage("stale lock test");

      expect(existsSync(lockPath)).toBe(false);
      const content = readFileSync(info.filePath, "utf-8");
      expect(content).toContain("## User: stale lock test");
    });
  });
});
