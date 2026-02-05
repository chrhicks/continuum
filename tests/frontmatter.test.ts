import { describe, expect, test } from "bun:test";

import { parseFrontmatter } from "../src/utils/frontmatter";

describe("parseFrontmatter", () => {
  test("returns no frontmatter when missing", () => {
    const input = "Hello world\nSecond line";
    const result = parseFrontmatter(input);

    expect(result.hasFrontmatter).toBe(false);
    expect(result.frontmatter).toEqual({});
    expect(result.keys).toEqual([]);
    expect(result.body).toBe(input);
  });

  test("parses simple frontmatter values", () => {
    const input = [
      "---",
      "title: Hello",
      "count: 2",
      "flag: true",
      "list: [a, b]",
      "---",
      "",
      "Body text",
    ].join("\n");

    const result = parseFrontmatter(input);

    expect(result.hasFrontmatter).toBe(true);
    expect(result.frontmatter).toEqual({
      title: "Hello",
      count: 2,
      flag: true,
      list: ["a", "b"],
    });
    expect(result.body).toBe("\nBody text");
  });
});
