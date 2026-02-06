import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { memoryPath } from "./paths";

export type MemoryConfig = {
  now_max_lines: number;
  now_max_hours: number;
  recent_session_count: number;
  recent_max_lines: number;
  memory_sections: string[];
};

const DEFAULT_SECTIONS = ["Architecture Decisions", "Technical Discoveries", "Development Patterns"];

const DEFAULT_CONFIG: MemoryConfig = {
  now_max_lines: 200,
  now_max_hours: 6,
  recent_session_count: 3,
  recent_max_lines: 500,
  memory_sections: [...DEFAULT_SECTIONS, "Sessions"]
};

export function getMemoryConfig(): MemoryConfig {
  const configPath = memoryPath("config.yml");
  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const raw = parse(readFileSync(configPath, "utf-8")) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") {
      return DEFAULT_CONFIG;
    }
    return normalizeConfig(raw);
  } catch {
    return DEFAULT_CONFIG;
  }
}

function normalizeConfig(raw: Record<string, unknown>): MemoryConfig {
  return {
    now_max_lines: readPositiveInt(raw.now_max_lines, DEFAULT_CONFIG.now_max_lines),
    now_max_hours: readPositiveNumber(raw.now_max_hours, DEFAULT_CONFIG.now_max_hours),
    recent_session_count: readPositiveInt(raw.recent_session_count, DEFAULT_CONFIG.recent_session_count),
    recent_max_lines: readPositiveInt(raw.recent_max_lines, DEFAULT_CONFIG.recent_max_lines),
    memory_sections: normalizeSections(raw.memory_sections)
  };
}

function readPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.round(value);
    if (rounded > 0) {
      return rounded;
    }
  }
  return fallback;
}

function readPositiveNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}

function normalizeSections(value: unknown): string[] {
  const provided = Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter((item) => item.length > 0)
    : [];

  const sections: string[] = [];
  if (provided.length > 0) {
    sections.push(...provided);
  } else {
    sections.push(...DEFAULT_SECTIONS);
  }

  if (sections.length < 3) {
    for (const fallback of DEFAULT_SECTIONS) {
      if (sections.length >= 3) {
        break;
      }
      if (!sections.includes(fallback)) {
        sections.push(fallback);
      }
    }
  }

  if (!sections.includes("Sessions")) {
    sections.push("Sessions");
  }

  return sections;
}
