import { describe, it, expect } from "vitest";
import { validateConfig } from "@/lib/config";
import { DEFAULT_CONFIG, compileConfig } from "@/lib/hierarchy";

describe("config / validateConfig", () => {
  it("accepts the default config and returns a cleaned value", () => {
    const { ok, errors, value } = validateConfig(DEFAULT_CONFIG);
    expect(ok).toBe(true);
    expect(errors).toEqual([]);
    expect(value.levels).toEqual([
      ["Epic"],
      ["Feature"],
      ["User Story"],
      ["Task", "Bug"],
    ]);
    expect(value.enforceLabels).toBe(false);
  });

  it("the cleaned value compiles cleanly", () => {
    const { value } = validateConfig(DEFAULT_CONFIG);
    const H = compileConfig(value);
    expect(H.levelCount).toBe(4);
  });

  it("rejects a non-object", () => {
    expect(validateConfig(null).ok).toBe(false);
    expect(validateConfig("nope").ok).toBe(false);
    expect(validateConfig(["x"]).ok).toBe(false);
  });

  it("requires a non-empty levels array", () => {
    expect(validateConfig({}).errors[0]).toMatch(/levels/);
    expect(validateConfig({ levels: [] }).errors[0]).toMatch(/levels/);
    expect(validateConfig({ levels: "Epic" }).errors[0]).toMatch(/levels/);
  });

  it("rejects empty level entries and empty type names", () => {
    expect(validateConfig({ levels: [[]] }).ok).toBe(false);
    expect(validateConfig({ levels: [["Epic"], [""]] }).ok).toBe(false);
    expect(validateConfig({ levels: [["Epic"], ["  "]] }).ok).toBe(false);
  });

  it("rejects a type that appears in more than one level", () => {
    const r = validateConfig({ levels: [["Epic"], ["Epic"]] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /more than one level/.test(e))).toBe(true);
  });

  it("treats duplicate detection as case-insensitive", () => {
    const r = validateConfig({ levels: [["Task"], ["task"]] });
    expect(r.ok).toBe(false);
  });

  it("trims type names in the cleaned value", () => {
    const r = validateConfig({ levels: [["  Epic  "], ["Feature"]] });
    expect(r.ok).toBe(true);
    expect(r.value.levels[0]).toEqual(["Epic"]);
  });

  it("validates aliases point to non-empty strings", () => {
    expect(validateConfig({ levels: [["Epic"]], aliases: { d: "" } }).ok).toBe(
      false
    );
    expect(validateConfig({ levels: [["Epic"]], aliases: [] }).ok).toBe(false);
    expect(
      validateConfig({ levels: [["Epic"]], aliases: { defect: "Epic" } }).ok
    ).toBe(true);
  });

  it("validates accents are hex colours", () => {
    expect(
      validateConfig({ levels: [["Epic"]], accents: { Epic: "blue" } }).ok
    ).toBe(false);
    expect(
      validateConfig({ levels: [["Epic"]], accents: { Epic: "#60a5fa" } }).ok
    ).toBe(true);
    expect(
      validateConfig({ levels: [["Epic"]], accents: { Epic: "#abc" } }).ok
    ).toBe(true);
  });

  it("validates allowedLabels is a string array", () => {
    expect(
      validateConfig({ levels: [["Epic"]], allowedLabels: "bug" }).ok
    ).toBe(false);
    expect(
      validateConfig({ levels: [["Epic"]], allowedLabels: [1, 2] }).ok
    ).toBe(false);
  });

  it("requires allowedLabels when enforceLabels is on", () => {
    const r = validateConfig({ levels: [["Epic"]], enforceLabels: true });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /allowedLabels` is empty/.test(e))).toBe(true);
  });

  it("accepts enforceLabels with a populated allow list and cleans it", () => {
    const r = validateConfig({
      levels: [["Epic"]],
      enforceLabels: true,
      allowedLabels: [" bug ", "tech-debt", ""],
    });
    expect(r.ok).toBe(true);
    expect(r.value.allowedLabels).toEqual(["bug", "tech-debt"]);
  });

  it("rejects a non-boolean enforceLabels", () => {
    expect(
      validateConfig({ levels: [["Epic"]], enforceLabels: "yes" }).ok
    ).toBe(false);
  });
});
