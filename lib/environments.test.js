import { describe, it, expect } from "vitest";
import { meetsRole } from "@/lib/access";
import {
  validateEnvironment,
  validateClaimNote,
  validateWelcome,
  findNameClash,
  canRelease,
  ENV_NAME_MAX_LENGTH,
  ENV_DESCRIPTION_MAX_LENGTH,
  CLAIM_NOTE_MAX_LENGTH,
  WELCOME_MAX_LENGTH,
} from "@/lib/environments";

describe("validateEnvironment", () => {
  it("accepts a name and trims it", () => {
    const r = validateEnvironment({ name: "  staging  " });
    expect(r.ok).toBe(true);
    expect(r.value.name).toBe("staging");
  });

  it("rejects a blank name", () => {
    const r = validateEnvironment({ name: "   " });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ field: "name" });
  });

  it("rejects an over-long name", () => {
    const r = validateEnvironment({ name: "x".repeat(ENV_NAME_MAX_LENGTH + 1) });
    expect(r.ok).toBe(false);
    expect(r.errors[0].field).toBe("name");
  });

  it("accepts a name at exactly the limit", () => {
    const r = validateEnvironment({ name: "x".repeat(ENV_NAME_MAX_LENGTH) });
    expect(r.ok).toBe(true);
  });

  it("rejects an over-long description", () => {
    const r = validateEnvironment({
      name: "ok",
      description: "d".repeat(ENV_DESCRIPTION_MAX_LENGTH + 1),
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0].field).toBe("description");
  });

  it("normalises a blank description to null so it clears", () => {
    const r = validateEnvironment({ name: "ok", description: "  " });
    expect(r.ok).toBe(true);
    expect(r.value.description).toBeNull();
  });

  // Partial updates: only supplied keys appear, so a PATCH that omits a field
  // leaves it alone rather than nulling it.
  it("omits keys that were not supplied", () => {
    const r = validateEnvironment({ description: "just this" });
    expect(r.ok).toBe(true);
    expect(r.value).not.toHaveProperty("name");
    expect(r.value.description).toBe("just this");
  });

  it("treats no input as a valid no-op", () => {
    const r = validateEnvironment({});
    expect(r.ok).toBe(true);
    expect(Object.keys(r.value)).toHaveLength(0);
  });
});

describe("findNameClash", () => {
  const existing = [
    { id: "a", name: "Staging" },
    { id: "b", name: "prod" },
  ];

  it("matches case-insensitively", () => {
    expect(findNameClash(existing, "staging")?.id).toBe("a");
    expect(findNameClash(existing, "PROD")?.id).toBe("b");
  });

  it("ignores surrounding whitespace", () => {
    expect(findNameClash(existing, "  staging ")?.id).toBe("a");
  });

  it("returns null when there is no clash", () => {
    expect(findNameClash(existing, "dev")).toBeNull();
  });

  // Renaming an environment must not collide with itself.
  it("excludes the environment being renamed", () => {
    expect(findNameClash(existing, "Staging", "a")).toBeNull();
    expect(findNameClash(existing, "Staging", "b")?.id).toBe("a");
  });

  it("never clashes on a blank name", () => {
    expect(findNameClash(existing, "  ")).toBeNull();
  });
});

describe("validateClaimNote", () => {
  it("accepts and trims a note", () => {
    expect(validateClaimNote("  testing  ")).toMatchObject({
      ok: true,
      value: "testing",
    });
  });

  it("turns a blank note into null", () => {
    expect(validateClaimNote("")).toMatchObject({ ok: true, value: null });
    expect(validateClaimNote(undefined)).toMatchObject({ ok: true, value: null });
  });

  it("rejects an over-long note", () => {
    const r = validateClaimNote("n".repeat(CLAIM_NOTE_MAX_LENGTH + 1));
    expect(r.ok).toBe(false);
    expect(r.errors[0].field).toBe("note");
  });
});

describe("canRelease", () => {
  const claim = { userId: "u1", login: "alice" };

  it("lets the holder release their own claim", () => {
    expect(canRelease({ claim, userId: "u1", role: "viewer" }, meetsRole)).toBe(true);
  });

  it("blocks a non-holder below admin", () => {
    expect(canRelease({ claim, userId: "u2", role: "viewer" }, meetsRole)).toBe(false);
    expect(canRelease({ claim, userId: "u2", role: "editor" }, meetsRole)).toBe(false);
  });

  // Admins can clear a claim somebody forgot to release.
  it("lets an admin or owner force-release", () => {
    expect(canRelease({ claim, userId: "u2", role: "admin" }, meetsRole)).toBe(true);
    expect(canRelease({ claim, userId: "u2", role: "owner" }, meetsRole)).toBe(true);
  });

  // Release is idempotent, so releasing a free environment is never an error.
  it("allows releasing an unclaimed environment", () => {
    expect(canRelease({ claim: null, userId: "u2", role: "viewer" }, meetsRole)).toBe(
      true
    );
  });
});

describe("validateWelcome", () => {
  it("trims and keeps markdown", () => {
    expect(validateWelcome("  # Hi  ")).toMatchObject({ ok: true, value: "# Hi" });
  });

  // Clearing the page is how the Welcome tab gets hidden again.
  it("turns blank markdown into null", () => {
    expect(validateWelcome("   ")).toMatchObject({ ok: true, value: null });
    expect(validateWelcome(null)).toMatchObject({ ok: true, value: null });
  });

  it("rejects markdown past the limit", () => {
    const r = validateWelcome("x".repeat(WELCOME_MAX_LENGTH + 1));
    expect(r.ok).toBe(false);
    expect(r.errors[0].field).toBe("welcomeMarkdown");
  });
});
