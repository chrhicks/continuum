import { existsSync, writeFileSync } from "node:fs";
import { ensureMemoryDir, memoryPath } from "./paths.ts";

const GITIGNORE_CONTENT = "*.tmp\n*.private\n.lock\nconsolidation.log.old\n";

export function initMemory(): void {
  ensureMemoryDir();

  const gitignorePath = memoryPath(".gitignore");
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, GITIGNORE_CONTENT, "utf-8");
  }

  const logPath = memoryPath("consolidation.log");
  if (!existsSync(logPath)) {
    writeFileSync(logPath, "", "utf-8");
  }
}
