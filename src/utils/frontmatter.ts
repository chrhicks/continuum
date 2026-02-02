export type Frontmatter = Record<string, unknown>;

export type FrontmatterParseResult = {
  frontmatter: Frontmatter;
  body: string;
  keys: string[];
  hasFrontmatter: boolean;
};

const FRONTMATTER_DELIMITER = "---";

export function parseFrontmatter(text: string): FrontmatterParseResult {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    return { frontmatter: {}, body: text, keys: [], hasFrontmatter: false };
  }

  const startIndex = text.indexOf(`${FRONTMATTER_DELIMITER}\n`);
  const endIndex = text.indexOf(`\n${FRONTMATTER_DELIMITER}\n`, startIndex + 4);
  if (endIndex === -1) {
    return { frontmatter: {}, body: text, keys: [], hasFrontmatter: false };
  }

  const frontmatterBlock = text.slice(startIndex + 4, endIndex);
  const body = text.slice(endIndex + 4);
  const lines = frontmatterBlock.split("\n").filter((line) => line.trim().length > 0);
  const frontmatter: Frontmatter = {};
  const keys: string[] = [];

  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }
    frontmatter[key] = parseValue(rawValue);
    keys.push(key);
  }

  return { frontmatter, body: body.replace(/^\n/, ""), keys, hasFrontmatter: true };
}

export function serializeFrontmatter(frontmatter: Frontmatter, order?: string[]): string {
  const keys = order && order.length > 0 ? order : Object.keys(frontmatter);
  const lines = keys
    .filter((key) => frontmatter[key] !== undefined)
    .map((key) => `${key}: ${formatValue(frontmatter[key])}`);
  return `${FRONTMATTER_DELIMITER}\n${lines.join("\n")}\n${FRONTMATTER_DELIMITER}`;
}

export function replaceFrontmatter(
  text: string,
  frontmatter: Frontmatter,
  order?: string[]
): string {
  const serialized = serializeFrontmatter(frontmatter, order);
  const trimmed = text.trimStart();
  if (!trimmed.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    return `${serialized}\n\n${text.trimStart()}`;
  }
  const startIndex = text.indexOf(`${FRONTMATTER_DELIMITER}\n`);
  const endIndex = text.indexOf(`\n${FRONTMATTER_DELIMITER}\n`, startIndex + 4);
  if (endIndex === -1) {
    return `${serialized}\n\n${text.trimStart()}`;
  }
  const remainder = text.slice(endIndex + 4).replace(/^\n/, "");
  return `${serialized}\n\n${remainder}`;
}

function parseValue(raw: string): unknown {
  if (raw === "null") {
    return null;
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .map((value) => unquote(value));
  }
  const numeric = Number(raw);
  if (!Number.isNaN(numeric) && raw !== "") {
    return numeric;
  }
  return unquote(raw);
}

function formatValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatValue(item)).join(", ")}]`;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return String(value);
}

function unquote(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
