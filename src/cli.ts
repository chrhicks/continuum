import { initMemory } from "./memory/init.ts";
import { getCurrentSessionPath, startSession, endSession } from "./memory/session.ts";
import { consolidateNow } from "./memory/consolidate.ts";
import { getStatus } from "./memory/status.ts";
import { appendAgentMessage, appendToolCall, appendUserMessage } from "./memory/now-writer.ts";
import { searchMemory, type MemorySearchTier } from "./memory/search.ts";
import { validateMemory } from "./memory/validate.ts";
import { readConsolidationLog } from "./memory/log.ts";
import { recoverStaleNowFiles } from "./memory/recover.ts";
import { writeLoopRequest } from "./loop/request.ts";
import { runLoopRequest } from "./loop/runner.ts";

let exitHandlersInstalled = false;

export async function main(): Promise<void> {
  installExitHandlers();
  const args = process.argv.slice(2);
  if (args.length === 0 || isHelp(args[0])) {
    printRootHelp();
    return;
  }

  if (args[0] === "loop") {
    await handleLoop(args.slice(1));
    return;
  }

  if (args[0] !== "memory") {
    throw new Error(`Unknown command: ${args[0]}`);
  }

  const action = args[1];
  if (!action) {
    printMemoryHelp();
    return;
  }
  if (isHelp(action)) {
    printMemoryHelp();
    return;
  }

  switch (action) {
    case "init":
      initMemory();
      console.log("Memory initialized at .continuum/memory/");
      return;
    case "loop":
      await handleLoop(args.slice(2));
      return;
    case "session":
      await handleSession(args.slice(2));
      return;
    case "status":
      handleStatus();
      return;
    case "consolidate":
      handleConsolidate(args.slice(2));
      return;
    case "append":
      await handleAppend(args.slice(2));
      return;
    case "search":
      handleSearch(args.slice(2));
      return;
    case "log":
      handleLog(args.slice(2));
      return;
    case "recover":
      handleRecover(args.slice(2));
      return;
    case "validate":
      handleValidate();
      return;
    default:
      throw new Error(`Unknown memory action: ${action}`);
  }
}

async function handleSession(args: string[]): Promise<void> {
  const action = args[0];
  if (!action) {
    throw new Error("Missing session action. Use: session start|end|append");
  }
  if (isHelp(action)) {
    printSessionHelp();
    return;
  }
  if (action === "start") {
    const info = startSession();
    console.log(`Session started: ${info.sessionId}`);
    console.log(`NOW file: ${info.filePath}`);
    return;
  }
  if (action === "end") {
    let shouldConsolidate = false;
    const options = args.slice(1);
    for (const option of options) {
      if (isHelp(option)) {
        printSessionHelp();
        return;
      }
      if (option === "--consolidate") {
        shouldConsolidate = true;
        continue;
      }
      throw new Error(`Unknown session end option: ${option}`);
    }
    const path = endSession();
    console.log(`Session ended: ${path}`);
    if (shouldConsolidate) {
      const result = consolidateNow();
      logConsolidationResult(result);
    }
    return;
  }
  if (action === "append") {
    await handleAppend(args.slice(1));
    return;
  }
  throw new Error(`Unknown session action: ${action}`);
}

function handleStatus(): void {
  const status = getStatus();
  console.log("Memory status:");
  console.log(`- NOW file: ${status.nowPath ?? "none"}`);
  console.log(`- NOW lines: ${status.nowLines}`);
  console.log(`- NOW age (minutes): ${status.nowAgeMinutes ?? "n/a"}`);
  console.log(`- NOW size: ${formatBytes(status.nowBytes)}`);
  console.log(`- RECENT lines: ${status.recentLines}`);
  console.log(`- Memory size: ${formatBytes(status.memoryBytes)}`);
  console.log(`- Last consolidation: ${status.lastConsolidation ?? "n/a"}`);
}

function handleConsolidate(args: string[]): void {
  if (args.length > 0 && isHelp(args[0])) {
    printConsolidateHelp();
    return;
  }

  let dryRun = false;
  for (const arg of args) {
    if (isHelp(arg)) {
      printConsolidateHelp();
      return;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    throw new Error(`Unknown consolidate option: ${arg}`);
  }

  const result = consolidateNow({ dryRun });
  logConsolidationResult(result);
}

function logConsolidationResult(result: ReturnType<typeof consolidateNow>): void {
  if (result.dryRun && result.preview) {
    console.log("Consolidation dry run (no files written):");
    console.log(`- RECENT: ${result.recentPath} (${result.preview.recentLines} lines)`);
    console.log(`- MEMORY: ${result.memoryPath} (${result.preview.memoryLines} lines)`);
    console.log(`- INDEX: ${result.memoryIndexPath} (${result.preview.memoryIndexLines} lines)`);
    console.log(`- LOG: ${result.logPath} (+${result.preview.logLines} lines)`);
    console.log(`- NOW: ${result.nowPath} (${result.preview.nowLines} lines)`);
    console.log("Note: Consolidation uses @decision/@discovery/@pattern markers from NOW.");
    return;
  }

  console.log("Consolidation complete:");
  console.log(`- RECENT: ${result.recentPath}`);
  console.log(`- MEMORY: ${result.memoryPath}`);
  console.log(`- INDEX: ${result.memoryIndexPath}`);
  console.log(`- LOG: ${result.logPath}`);
  console.log("Note: Consolidation uses @decision/@discovery/@pattern markers from NOW.");
}

function handleSearch(args: string[]): void {
  if (args.length === 0 || isHelp(args[0])) {
    printSearchHelp();
    return;
  }

  let tier: MemorySearchTier | undefined;
  let tags: string[] | undefined;
  const queryParts: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (isHelp(arg)) {
      printSearchHelp();
      return;
    }
    if (arg.startsWith("--tier=")) {
      const value = arg.slice("--tier=".length);
      if (!value) {
        throw new Error("Missing tier. Use: continuum memory search <query> --tier NOW|RECENT|MEMORY|all");
      }
      tier = parseSearchTier(value);
      continue;
    }
    if (arg === "--tier") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Missing tier. Use: continuum memory search <query> --tier NOW|RECENT|MEMORY|all");
      }
      tier = parseSearchTier(value);
      i += 1;
      continue;
    }
    if (arg.startsWith("--tags=")) {
      const value = arg.slice("--tags=".length);
      if (!value) {
        throw new Error("Missing tags. Use: continuum memory search <query> --tags tag1,tag2");
      }
      tags = parseSearchTags(value);
      continue;
    }
    if (arg === "--tags") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Missing tags. Use: continuum memory search <query> --tags tag1,tag2");
      }
      tags = parseSearchTags(value);
      i += 1;
      continue;
    }
    queryParts.push(arg);
  }

  const query = queryParts.join(" ").trim();
  if (!query) {
    throw new Error("Missing search query.");
  }

  const result = searchMemory(query, tier ?? "all", tags ?? []);
  if (result.filesSearched === 0) {
    console.log("No memory files found.");
    return;
  }
  if (result.matches.length === 0) {
    console.log(`No matches found for "${query}".`);
    console.log(`Files searched: ${result.filesSearched}`);
    return;
  }

  const matchLabel = result.matches.length === 1 ? "match" : "matches";
  const fileLabel = result.filesSearched === 1 ? "file" : "files";
  console.log(`Found ${result.matches.length} ${matchLabel} in ${result.filesSearched} ${fileLabel}:`);
  for (const match of result.matches) {
    console.log(`- ${match.filePath}:${match.lineNumber} ${match.lineText}`);
  }
}

function handleValidate(): void {
  const result = validateMemory();
  if (result.filesChecked === 0) {
    console.log("No memory files found.");
    return;
  }
  if (result.errors.length === 0) {
    console.log(`Memory validation passed (${result.filesChecked} files checked).`);
    return;
  }

  console.error(`Memory validation failed with ${result.errors.length} issue(s):`);
  for (const error of result.errors) {
    console.error(`- ${error.filePath}:${error.lineNumber} ${error.message}`);
  }
  process.exitCode = 1;
}

function handleLog(args: string[]): void {
  if (args.length > 0 && isHelp(args[0])) {
    printLogHelp();
    return;
  }

  let tail: number | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (isHelp(arg)) {
      printLogHelp();
      return;
    }
    if (arg.startsWith("--tail=")) {
      const value = arg.slice("--tail=".length);
      tail = parseTail(value);
      continue;
    }
    if (arg === "--tail") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Missing tail count. Use: continuum memory log --tail <lines>");
      }
      tail = parseTail(value);
      i += 1;
      continue;
    }
    throw new Error(`Unknown log option: ${arg}`);
  }

  const result = readConsolidationLog({ tail });
  if (result.totalLines === 0) {
    console.log("No consolidation log entries found.");
    return;
  }

  const tailLabel = result.truncated ? ` (showing last ${result.lines.length} of ${result.totalLines} lines)` : "";
  console.log(`Consolidation log${tailLabel}:`);
  console.log(`- Path: ${result.filePath}`);
  console.log(result.lines.join("\n"));
}

function handleRecover(args: string[]): void {
  if (args.length > 0 && isHelp(args[0])) {
    printRecoverHelp();
    return;
  }

  let maxHours: number | undefined;
  let consolidate = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (isHelp(arg)) {
      printRecoverHelp();
      return;
    }
    if (arg.startsWith("--hours=")) {
      const value = arg.slice("--hours=".length);
      maxHours = parseHours(value);
      continue;
    }
    if (arg === "--hours") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Missing hours. Use: continuum memory recover --hours <hours>");
      }
      maxHours = parseHours(value);
      i += 1;
      continue;
    }
    if (arg === "--consolidate") {
      consolidate = true;
      continue;
    }
    throw new Error(`Unknown recover option: ${arg}`);
  }

  const result = recoverStaleNowFiles({ maxHours, consolidate });
  if (result.totalNowFiles === 0) {
    console.log("No NOW files found.");
    return;
  }
  if (result.staleNowFiles.length === 0) {
    console.log(`No stale NOW files found (threshold: ${result.thresholdHours}h).`);
    return;
  }

  console.log(`Stale NOW files (>${result.thresholdHours}h):`);
  for (const stale of result.staleNowFiles) {
    const hours = Math.round(stale.ageHours * 10) / 10;
    console.log(`- ${stale.filePath} (${hours}h old)`);
  }

  if (consolidate) {
    console.log(`Recovered ${result.recovered.length} session(s).`);
  } else {
    console.log("Run with --consolidate to recover these sessions.");
  }
}

async function handleAppend(args: string[]): Promise<void> {
  if (args.length === 0 || isHelp(args[0])) {
    printAppendHelp();
    return;
  }
  const kind = args[0];
  if (kind === "user") {
    const message = requireMessage(args.slice(1));
    const exitCommand = parseExitCommand(message);
    if (exitCommand) {
      const path = endSessionIfActive({ consolidate: exitCommand.consolidate });
      if (!path) {
        throw new Error("No active NOW session found.");
      }
      console.log(`Session ended: ${path}`);
      return;
    }
    await appendUserMessage(message);
    console.log("Appended user message to NOW.");
    return;
  }
  if (kind === "agent") {
    const message = requireMessage(args.slice(1));
    await appendAgentMessage(message);
    console.log("Appended agent message to NOW.");
    return;
  }
  if (kind === "tool") {
    const toolName = args[1];
    if (!toolName) {
      throw new Error("Missing tool name. Use: memory append tool <name> [summary]");
    }
    const summary = args.slice(2).join(" ").trim() || undefined;
    await appendToolCall(toolName, summary);
    console.log("Appended tool call to NOW.");
    return;
  }
  throw new Error(`Unknown append kind: ${kind}`);
}

function printRootHelp(): void {
  console.log("Usage:");
  console.log("  continuum loop -n <count>");
  console.log("  continuum memory <command>");
  console.log("");
  console.log("Memory commands:");
  console.log("  continuum memory init");
  console.log("  continuum memory session start");
  console.log("  continuum memory session end [--consolidate]");
  console.log("  continuum memory session append <user|agent|tool> <text>");
  console.log("  continuum memory consolidate [--dry-run]");
  console.log("  continuum memory status");
  console.log("  continuum memory search <query> [--tier NOW|RECENT|MEMORY|all] [--tags tag1,tag2]");
  console.log("  continuum memory log [--tail <lines>]");
  console.log("  continuum memory recover [--hours <hours>] [--consolidate]");
  console.log("  continuum memory validate");
  console.log("  continuum memory append <user|agent|tool> <text>");
  console.log("  continuum memory loop -n <count>");
  console.log("");
  console.log("Markers:");
  console.log("  Use @decision, @discovery, @pattern in NOW to extract highlights.");
}

function printMemoryHelp(): void {
  console.log("Usage:");
  console.log("  continuum memory init");
  console.log("  continuum memory session start");
  console.log("  continuum memory session end [--consolidate]");
  console.log("  continuum memory session append <user|agent|tool> <text>");
  console.log("  continuum memory consolidate [--dry-run]");
  console.log("  continuum memory status");
  console.log("  continuum memory search <query> [--tier NOW|RECENT|MEMORY|all] [--tags tag1,tag2]");
  console.log("  continuum memory log [--tail <lines>]");
  console.log("  continuum memory recover [--hours <hours>] [--consolidate]");
  console.log("  continuum memory validate");
  console.log("  continuum memory append <user|agent|tool> <text>");
  console.log("  continuum memory loop -n <count>");
  console.log("");
  console.log("Markers:");
  console.log("  Use @decision, @discovery, @pattern in NOW to extract highlights.");
}

async function handleLoop(args: string[]): Promise<void> {
  if (args.length === 0 || isHelp(args[0])) {
    printLoopHelp();
    return;
  }
  const countIndex = args.findIndex((arg) => arg === "-n" || arg === "--count");
  if (countIndex === -1 || !args[countIndex + 1]) {
    throw new Error("Missing count. Use: continuum memory loop -n <count>");
  }
  const count = Number(args[countIndex + 1]);
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("Count must be a positive integer.");
  }
  const path = writeLoopRequest(count);
  console.log(`Loop request created: ${path}`);
  const result = await runLoopRequest(path);
  console.log(result.message);
  if (!result.invoked) {
    console.log("Run the agent loop skill to process the request when available.");
  }
}

function printLoopHelp(): void {
  console.log("Usage:");
  console.log("  continuum memory loop -n <count>");
}

function printSessionHelp(): void {
  console.log("Usage:");
  console.log("  continuum memory session start");
  console.log("  continuum memory session end [--consolidate]");
  console.log("  continuum memory session append <user|agent|tool> <text>");
}

function printAppendHelp(): void {
  console.log("Usage:");
  console.log("  continuum memory append user <message>");
  console.log("  continuum memory append agent <message>");
  console.log("  continuum memory append tool <name> [summary]");
  console.log("  (Use /exit or /exit --consolidate in user messages to end the session.)");
}

function printSearchHelp(): void {
  console.log("Usage:");
  console.log("  continuum memory search <query> [--tier NOW|RECENT|MEMORY|all] [--tags tag1,tag2]");
}

function printLogHelp(): void {
  console.log("Usage:");
  console.log("  continuum memory log [--tail <lines>]");
}

function printRecoverHelp(): void {
  console.log("Usage:");
  console.log("  continuum memory recover [--hours <hours>] [--consolidate]");
}

function printConsolidateHelp(): void {
  console.log("Usage:");
  console.log("  continuum memory consolidate [--dry-run]");
}

function requireMessage(parts: string[]): string {
  const message = parts.join(" ").trim();
  if (!message) {
    throw new Error("Missing message text.");
  }
  return message;
}

function installExitHandlers(): void {
  if (exitHandlersInstalled) {
    return;
  }
  exitHandlersInstalled = true;
  process.once("SIGINT", () => {
    try {
      const path = endSessionIfActive({ consolidate: false });
      if (path) {
        console.log(`Session ended: ${path}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
    } finally {
      exitHandlersInstalled = false;
      process.exitCode = 130;
    }
  });
}

function endSessionIfActive(options: { consolidate: boolean }): string | null {
  if (!getCurrentSessionPath()) {
    return null;
  }
  const path = endSession();
  if (options.consolidate) {
    const result = consolidateNow();
    logConsolidationResult(result);
  }
  return path;
}

function parseExitCommand(message: string): { consolidate: boolean } | null {
  const trimmed = message.trim();
  if (trimmed === "/exit") {
    return { consolidate: false };
  }
  if (trimmed === "/exit --consolidate") {
    return { consolidate: true };
  }
  return null;
}

function isHelp(value?: string): boolean {
  return value === "--help" || value === "-h";
}

function parseSearchTier(value: string): MemorySearchTier {
  const normalized = value.toUpperCase();
  if (normalized === "NOW" || normalized === "RECENT" || normalized === "MEMORY") {
    return normalized;
  }
  if (normalized === "ALL") {
    return "all";
  }
  throw new Error("Invalid tier. Use: NOW, RECENT, MEMORY, or all.");
}

function parseSearchTags(value: string): string[] {
  const tags = value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
  if (tags.length === 0) {
    throw new Error("Missing tags. Use: continuum memory search <query> --tags tag1,tag2");
  }
  return tags;
}

function parseTail(value: string): number {
  const count = Number(value);
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("Tail count must be a positive integer.");
  }
  return count;
}

function parseHours(value: string): number {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error("Hours must be a positive number.");
  }
  return hours;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return "n/a";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}
