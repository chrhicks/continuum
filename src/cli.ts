import { initMemory } from "./memory/init.ts";
import { startSession, endSession } from "./memory/session.ts";
import { consolidateNow } from "./memory/consolidate.ts";
import { getStatus } from "./memory/status.ts";
import { appendAgentMessage, appendToolCall, appendUserMessage } from "./memory/now-writer.ts";
import { writeLoopRequest } from "./loop/request.ts";

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || isHelp(args[0])) {
    printRootHelp();
    return;
  }

  if (args[0] === "loop") {
    handleLoop(args.slice(1));
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
      handleLoop(args.slice(2));
      return;
    case "session":
      await handleSession(args.slice(2));
      return;
    case "status":
      handleStatus();
      return;
    case "consolidate":
      handleConsolidate();
      return;
    case "append":
      await handleAppend(args.slice(2));
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
    const path = endSession();
    console.log(`Session ended: ${path}`);
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
  console.log(`- RECENT lines: ${status.recentLines}`);
  console.log(`- Last consolidation: ${status.lastConsolidation ?? "n/a"}`);
}

function handleConsolidate(): void {
  const result = consolidateNow();
  console.log("Consolidation complete:");
  console.log(`- RECENT: ${result.recentPath}`);
  console.log(`- MEMORY: ${result.memoryPath}`);
  console.log(`- INDEX: ${result.memoryIndexPath}`);
  console.log(`- LOG: ${result.logPath}`);
  console.log("Note: Consolidation uses @decision/@discovery/@pattern markers from NOW.");
}

async function handleAppend(args: string[]): Promise<void> {
  if (args.length === 0 || isHelp(args[0])) {
    printAppendHelp();
    return;
  }
  const kind = args[0];
  if (kind === "user") {
    const message = requireMessage(args.slice(1));
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
  console.log("  continuum memory session end");
  console.log("  continuum memory session append <user|agent|tool> <text>");
  console.log("  continuum memory consolidate");
  console.log("  continuum memory status");
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
  console.log("  continuum memory session end");
  console.log("  continuum memory session append <user|agent|tool> <text>");
  console.log("  continuum memory consolidate");
  console.log("  continuum memory status");
  console.log("  continuum memory append <user|agent|tool> <text>");
  console.log("  continuum memory loop -n <count>");
  console.log("");
  console.log("Markers:");
  console.log("  Use @decision, @discovery, @pattern in NOW to extract highlights.");
}

function handleLoop(args: string[]): void {
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
  console.log("Agent loop skill should now process the request.");
}

function printLoopHelp(): void {
  console.log("Usage:");
  console.log("  continuum memory loop -n <count>");
}

function printSessionHelp(): void {
  console.log("Usage:");
  console.log("  continuum memory session start");
  console.log("  continuum memory session end");
  console.log("  continuum memory session append <user|agent|tool> <text>");
}

function printAppendHelp(): void {
  console.log("Usage:");
  console.log("  continuum memory append user <message>");
  console.log("  continuum memory append agent <message>");
  console.log("  continuum memory append tool <name> [summary]");
}

function requireMessage(parts: string[]): string {
  const message = parts.join(" ").trim();
  if (!message) {
    throw new Error("Missing message text.");
  }
  return message;
}

function isHelp(value?: string): boolean {
  return value === "--help" || value === "-h";
}
