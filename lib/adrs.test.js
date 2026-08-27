import { describe, it, expect } from "vitest";
import {
  isAdrFile,
  adrTitle,
  prettifyFileName,
  adrNumber,
  sortAdrs,
  normalizeAdrPath,
} from "@/lib/adrs";

describe("isAdrFile", () => {
  it("accepts markdown", () => {
    expect(isAdrFile("0001-thing.md")).toBe(true);
    expect(isAdrFile("notes.MDX")).toBe(true);
  });

  // ADR folders routinely hold diagrams and templates alongside the records.
  it("rejects everything else", () => {
    expect(isAdrFile("diagram.png")).toBe(false);
    expect(isAdrFile("")).toBe(false);
    expect(isAdrFile(undefined)).toBe(false);
  });
});

describe("adrTitle", () => {
  it("prefers the first H1", () => {
    expect(adrTitle("0001-x.md", "# Use Postgres\n\nBody")).toBe("Use Postgres");
  });

  it("skips frontmatter and lower-level headings", () => {
    expect(adrTitle("0001-x.md", "## Status\n\nAccepted\n\n# Real Title")).toBe(
      "Real Title"
    );
  });

  // A record with no heading must still read as something.
  it("falls back to a prettified file name", () => {
    expect(adrTitle("0007-use-postgres.md", "no heading here")).toBe(
      "0007 Use postgres"
    );
    expect(adrTitle("0007-use-postgres.md", null)).toBe("0007 Use postgres");
  });

  it("ignores a hash that isn't a heading", () => {
    expect(adrTitle("a-b.md", "#nospace\ntext")).toBe("A b");
  });
});

describe("prettifyFileName", () => {
  it("keeps the numeric prefix, which carries identity", () => {
    expect(prettifyFileName("0012-adopt-drizzle.md")).toBe("0012 Adopt drizzle");
  });

  it("handles underscores and no extension", () => {
    expect(prettifyFileName("some_record")).toBe("Some record");
  });
});

describe("adrNumber", () => {
  it("reads a leading number", () => {
    expect(adrNumber("0009-x.md")).toBe(9);
    expect(adrNumber("10-x.md")).toBe(10);
  });

  it("returns null when unnumbered", () => {
    expect(adrNumber("README.md")).toBeNull();
  });
});

describe("sortAdrs", () => {
  // String sorting would put "10" before "9".
  it("orders numerically, not lexically", () => {
    const out = sortAdrs([
      { fileName: "10-ten.md" },
      { fileName: "9-nine.md" },
      { fileName: "2-two.md" },
    ]);
    expect(out.map((a) => a.fileName)).toEqual([
      "2-two.md",
      "9-nine.md",
      "10-ten.md",
    ]);
  });

  it("puts unnumbered files after numbered ones, alphabetically", () => {
    const out = sortAdrs([
      { fileName: "template.md" },
      { fileName: "1-one.md" },
      { fileName: "README.md" },
    ]);
    expect(out.map((a) => a.fileName)).toEqual([
      "1-one.md",
      "README.md",
      "template.md",
    ]);
  });

  it("does not mutate its input", () => {
    const input = [{ fileName: "2.md" }, { fileName: "1.md" }];
    sortAdrs(input);
    expect(input[0].fileName).toBe("2.md");
  });
});

describe("normalizeAdrPath", () => {
  it("strips surrounding slashes and whitespace", () => {
    expect(normalizeAdrPath("  /docs/adr/  ")).toBe("docs/adr");
    expect(normalizeAdrPath("docs/adr")).toBe("docs/adr");
  });

  it("normalises empty input to an empty string", () => {
    expect(normalizeAdrPath(null)).toBe("");
    expect(normalizeAdrPath("///")).toBe("");
  });
});
