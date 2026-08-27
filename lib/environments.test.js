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
  resolveClaimExpiry,
  isClaimExpired,
  describeRemaining,
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

describe("resolveClaimExpiry", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);

  it("turns hours into an absolute instant", () => {
    const r = resolveClaimExpiry(4, now);
    expect(r.ok).toBe(true);
    expect(r.value.getTime()).toBe(now + 4 * 3_600_000);
  });

  // "No expiry" must stay possible for genuinely long-running work.
  it("treats null/empty as no expiry", () => {
    for (const v of [null, undefined, ""]) {
      const r = resolveClaimExpiry(v, now);
      expect(r.ok).toBe(true);
      expect(r.value).toBeNull();
    }
  });

  it("rejects nonsense and non-positive durations", () => {
    expect(resolveClaimExpiry("soon", now).ok).toBe(false);
    expect(resolveClaimExpiry(0, now).ok).toBe(false);
    expect(resolveClaimExpiry(-5, now).ok).toBe(false);
  });

  // An open-ended hold should be a deliberate "No expiry", not 10000 hours.
  it("caps the maximum duration", () => {
    expect(resolveClaimExpiry(168, now).ok).toBe(true);
    expect(resolveClaimExpiry(169, now).ok).toBe(false);
  });
});

describe("isClaimExpired", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);

  it("treats no claim as expired, so the slot is free", () => {
    expect(isClaimExpired(null, now)).toBe(true);
  });

  it("never expires a claim with no expiry set", () => {
    expect(isClaimExpired({ expiresAt: null }, now)).toBe(false);
  });

  it("expires exactly on the boundary", () => {
    expect(isClaimExpired({ expiresAt: new Date(now) }, now)).toBe(true);
    expect(isClaimExpired({ expiresAt: new Date(now + 1000) }, now)).toBe(false);
  });

  // A corrupt timestamp must not silently free a live claim.
  it("does not expire on an unparseable date", () => {
    expect(isClaimExpired({ expiresAt: "nonsense" }, now)).toBe(false);
  });
});

describe("describeRemaining", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const inMs = (ms) => new Date(now + ms).toISOString();

  it("returns null when there is no expiry", () => {
    expect(describeRemaining(null, now)).toBeNull();
  });

  it("describes minutes, hours and days", () => {
    expect(describeRemaining(inMs(30 * 60_000), now)).toBe("30m left");
    expect(describeRemaining(inMs(5 * 3_600_000), now)).toBe("5h left");
    expect(describeRemaining(inMs(24 * 3_600_000), now)).toBe("1 day left");
    expect(describeRemaining(inMs(72 * 3_600_000), now)).toBe("3 days left");
  });

  it("never claims 0m left while time remains", () => {
    expect(describeRemaining(inMs(20_000), now)).toBe("1m left");
  });

  it("reports a lapsed claim as expired", () => {
    expect(describeRemaining(inMs(-1000), now)).toBe("expired");
  });
});
