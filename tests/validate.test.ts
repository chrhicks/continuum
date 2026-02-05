import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { validateMemory } from "../src/memory/validate";

function withTempMemoryDir(run: (memoryDir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "continuum-memory-"));
  const memoryDir = join(root, "memory");
  try {
    rmSync(memoryDir, { recursive: true, force: true });
    mkdirSync(memoryDir, { recursive: true });
    run(memoryDir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("validateMemory", () => {
  test("flags missing frontmatter keys", () => {
    withTempMemoryDir((memoryDir) => {
      const nowPath = join(memoryDir, "NOW-2026-02-02T00-00.md");
      writeFileSync(
        nowPath,
        ["---", "session_id: sess_test", "memory_type: NOW", "---", ""].join("\n"),
        "utf-8"
      );

      const result = validateMemory({ memoryDir });
      const messages = result.errors.map((error) => error.message);

      expect(messages.some((message) => message.includes("Missing frontmatter key"))).toBe(true);
    });
  });

  test("flags missing anchors referenced by MEMORY.md", () => {
    withTempMemoryDir((memoryDir) => {
      const memoryFile = join(memoryDir, "MEMORY-2026-02-02.md");
      writeFileSync(
        memoryFile,
        [
          "---",
          "consolidation_date: 2026-02-02T00:00:00Z",
          "source_sessions: [sess_test]",
          "total_sessions_consolidated: 1",
          "tags: []",
          "consolidated_by: continuum-test",
          "---",
          "",
          "# Consolidated Memory",
          "",
          "## Session 2026-02-02 02:00 UTC (sess_test)",
          "<a name=\"session-present\"></a>",
          "",
        ].join("\n"),
        "utf-8"
      );

      const indexFile = join(memoryDir, "MEMORY.md");
      writeFileSync(
        indexFile,
        [
          "# Long-term Memory Index",
          "",
          "## Sessions",
          "- **[Session 2026-02-02 02:00](MEMORY-2026-02-02.md#session-missing)** - Session work",
          "",
        ].join("\n"),
        "utf-8"
      );

      const result = validateMemory({ memoryDir });
      const messages = result.errors.map((error) => error.message);

      expect(messages.some((message) => message.includes("Missing anchor"))).toBe(true);
    });
  });

  test("flags invalid frontmatter value types", () => {
    withTempMemoryDir((memoryDir) => {
      const nowPath = join(memoryDir, "NOW-2026-02-02T00-00.md");
      writeFileSync(
        nowPath,
        [
          "---",
          "session_id: sess_test",
          "timestamp_start: not-a-timestamp",
          "timestamp_end: null",
          "duration_minutes: not-a-number",
          "project_path: /tmp",
          "tags: not-an-array",
          "parent_session: null",
          "related_tasks: []",
          "memory_type: NOW",
          "---",
          "",
        ].join("\n"),
        "utf-8"
      );

      const result = validateMemory({ memoryDir });
      const messages = result.errors.map((error) => error.message);
      expect(messages.some((message) => message.includes("Invalid frontmatter value"))).toBe(true);
    });
  });

  test("accepts heading-based anchors", () => {
    withTempMemoryDir((memoryDir) => {
      const memoryFile = join(memoryDir, "MEMORY-2026-02-02.md");
      writeFileSync(
        memoryFile,
        [
          "---",
          "consolidation_date: 2026-02-02T00:00:00Z",
          "source_sessions: [sess_test]",
          "total_sessions_consolidated: 1",
          "tags: []",
          "consolidated_by: continuum-test",
          "---",
          "",
          "# Consolidated Memory",
          "",
          "## Session Alpha",
          "",
        ].join("\n"),
        "utf-8"
      );

      const indexFile = join(memoryDir, "MEMORY.md");
      writeFileSync(
        indexFile,
        [
          "# Long-term Memory Index",
          "",
          "## Sessions",
          "- **[Session Alpha](MEMORY-2026-02-02.md#session-alpha)** - Session work",
          "",
        ].join("\n"),
        "utf-8"
      );

      const result = validateMemory({ memoryDir });
      const messages = result.errors.map((error) => error.message);
      expect(messages.some((message) => message.includes("Missing anchor"))).toBe(false);
    });
  });

  test("reports accurate filesChecked count", () => {
    withTempMemoryDir((memoryDir) => {
      writeFileSync(
        join(memoryDir, "NOW-2026-02-02T00-00.md"),
        [
          "---",
          "session_id: sess_test",
          "timestamp_start: 2026-02-02T00:00:00Z",
          "timestamp_end: null",
          "duration_minutes: null",
          "project_path: /tmp",
          "tags: []",
          "parent_session: null",
          "related_tasks: []",
          "memory_type: NOW",
          "---",
          ""
        ].join("\n"),
        "utf-8"
      );
      writeFileSync(
        join(memoryDir, "MEMORY-2026-02-02.md"),
        [
          "---",
          "consolidation_date: 2026-02-02T00:00:00Z",
          "source_sessions: [sess_test]",
          "total_sessions_consolidated: 1",
          "tags: []",
          "consolidated_by: continuum-test",
          "---",
          ""
        ].join("\n"),
        "utf-8"
      );
      writeFileSync(join(memoryDir, "MEMORY.md"), "# Index", "utf-8");
      writeFileSync(join(memoryDir, "RECENT.md"), "# Recent", "utf-8");

      const result = validateMemory({ memoryDir });
      expect(result.filesChecked).toBe(3);
    });
  });
});
