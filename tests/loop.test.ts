import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runLoopRequest } from "../src/loop/runner";

async function withTempCwd(run: () => Promise<void> | void): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "continuum-loop-"));
  const previous = process.cwd();
  try {
    process.chdir(root);
    await run();
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
}

describe("runLoopRequest", () => {
  test("returns error and preserves request on invalid JSON", async () => {
    await withTempCwd(async () => {
      const loopDir = join(process.cwd(), ".continuum", "loop");
      mkdirSync(loopDir, { recursive: true });
      const requestPath = join(loopDir, "request.json");
      writeFileSync(requestPath, "{invalid json", "utf-8");

      const result = await runLoopRequest(requestPath);

      expect(result.invoked).toBe(false);
      expect(result.message).toMatch(/Invalid loop request JSON/);
      expect(existsSync(requestPath)).toBe(true);
    });
  });
});
