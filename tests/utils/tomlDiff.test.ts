import { describe, expect, it } from "vitest";
import { compareToml } from "@/utils/tomlDiff";

describe("TOML application preview", () => {
  it("ignores comments, whitespace, table order and key order", () => {
    const result = compareToml(
      "# disk\nb=2\na=1\n[table]\nx=true\n",
      "[table]\nx = true\n\n[root]\nvalue=1",
    );
    expect(result.equal).toBe(false);
    const equal = compareToml(
      "# disk\nb=2\na=1\n[table]\nx=true\n",
      "a = 1\nb = 2\n\n[table]\nx = true",
    );
    expect(equal.equal).toBe(true);
    expect(equal.original).toBe(equal.modified);
  });

  it("counts nested values, additions, deletions and whole-array replacements", () => {
    const result = compareToml(
      'removed=true\n[model]\neffort="medium"\nlist=[1,2]',
      'added=true\n[model]\neffort="high"\nlist=[2,1]',
    );
    expect(result.counts).toEqual({ added: 1, modified: 2, removed: 1 });
  });

  it("preserves dates, special numbers and string content", () => {
    const text =
      'when=2026-09-29T12:00:00Z\nlimit=inf\nunknown=nan\nmessage="a  b"';
    expect(compareToml(text, text).equal).toBe(true);
    expect(compareToml(text, text.replace("a  b", "a b")).counts.modified).toBe(
      1,
    );
  });

  it("falls back to raw text for invalid disk TOML", () => {
    const result = compareToml('model = "unterminated', 'model = "valid"');
    expect(result.error).not.toBe("");
    expect(result.original).toBe('model = "unterminated');
  });
});
