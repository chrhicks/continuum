import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { initMemory } from "../src/memory/init";
import { MEMORY_LOCK_PATH, withMemoryLock } from "../src/memory/lock";

async function withTempCwd(run: () => Promise<void> | void): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "continuum-memory-lock-"));
  const previous = process.cwd();
  try {
    process.chdir(root);
    await run();
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
}

describe("memory lock", () => {
  test("clears stale lock files", async () => {
    await withTempCwd(() => {
      initMemory();
      writeFileSync(MEMORY_LOCK_PATH, "lock", "utf-8");
      const staleTime = new Date(Date.now() - 120_000);
      utimesSync(MEMORY_LOCK_PATH, staleTime, staleTime);

      const result = withMemoryLock(() => "ok");

      expect(result).toBe("ok");
      expect(existsSync(MEMORY_LOCK_PATH)).toBe(false);
    });
  });

  test("throws when lock is held", async () => {
    await withTempCwd(() => {
      initMemory();
      writeFileSync(MEMORY_LOCK_PATH, "lock", "utf-8");

      expect(() =>
        withMemoryLock(() => "ok", {
          retries: 1,
          retryDelayMs: 1,
          staleLockMs: 999_999
        })
      ).toThrow("Memory operations are locked. Try again shortly.");
      expect(existsSync(MEMORY_LOCK_PATH)).toBe(true);
    });
  });
});
