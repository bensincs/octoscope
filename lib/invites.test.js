import { describe, it, expect } from "vitest";
import {
  generateInviteToken,
  hashInviteToken,
  hashesMatch,
  resolveInviteExpiry,
  inviteRejectionReason,
  inviteStatus,
  DEFAULT_INVITE_HOURS,
} from "@/lib/invites";

describe("generateInviteToken", () => {
  it("is long and URL-safe", () => {
    const t = generateInviteToken();
    // 32 bytes base64url -> 43 chars, no padding or characters needing escaping.
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateInviteToken()));
    expect(seen.size).toBe(200);
  });
});

describe("hashInviteToken", () => {
  it("is deterministic and hides the token", () => {
    const t = generateInviteToken();
    const h = hashInviteToken(t);
    expect(h).toBe(hashInviteToken(t));
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).not.toContain(t);
  });

  it("differs for different tokens", () => {
    expect(hashInviteToken("a")).not.toBe(hashInviteToken("b"));
  });
});

describe("hashesMatch", () => {
  it("compares equal and unequal values", () => {
    const h = hashInviteToken("x");
    expect(hashesMatch(h, h)).toBe(true);
    expect(hashesMatch(h, hashInviteToken("y"))).toBe(false);
  });

  // Different lengths must not throw from timingSafeEqual.
  it("handles mismatched lengths safely", () => {
    expect(hashesMatch("short", hashInviteToken("x"))).toBe(false);
    expect(hashesMatch(undefined, null)).toBe(true);
  });
});

describe("resolveInviteExpiry", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);

  it("defaults when nothing is supplied", () => {
    const r = resolveInviteExpiry(undefined, now);
    expect(r.ok).toBe(true);
    expect(r.value.getTime()).toBe(now + DEFAULT_INVITE_HOURS * 3_600_000);
  });

  it("accepts the offered durations", () => {
    for (const h of [1, 24, 168]) {
      expect(resolveInviteExpiry(h, now).ok).toBe(true);
    }
  });

  // An invite with no expiry is a permanent way in, so there is no such option.
  it("rejects zero, negatives and anything past a week", () => {
    expect(resolveInviteExpiry(0, now).ok).toBe(false);
    expect(resolveInviteExpiry(-1, now).ok).toBe(false);
    expect(resolveInviteExpiry(169, now).ok).toBe(false);
    expect(resolveInviteExpiry("soon", now).ok).toBe(false);
  });
});

describe("inviteRejectionReason", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const live = { expiresAt: new Date(now + 3_600_000) };

  it("accepts a live invite", () => {
    expect(inviteRejectionReason(live, now)).toBeNull();
  });

  it("rejects unknown, used and expired invites", () => {
    expect(inviteRejectionReason(null, now)).toMatch(/not valid/i);
    expect(inviteRejectionReason({ ...live, usedAt: new Date() }, now)).toMatch(
      /already been used/i,
    );
    expect(
      inviteRejectionReason({ expiresAt: new Date(now - 1) }, now),
    ).toMatch(/expired/i);
  });

  // Someone told "revoked" should not be left thinking they merely arrived late.
  it("reports revocation ahead of expiry", () => {
    const both = { expiresAt: new Date(now - 1), revokedAt: new Date(now - 2) };
    expect(inviteRejectionReason(both, now)).toMatch(/revoked/i);
  });

  it("expires exactly on the boundary", () => {
    expect(inviteRejectionReason({ expiresAt: new Date(now) }, now)).toMatch(/expired/i);
  });
});

describe("inviteStatus", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);

  it("classifies each state", () => {
    expect(inviteStatus({ expiresAt: new Date(now + 1000) }, now)).toBe("active");
    expect(inviteStatus({ expiresAt: new Date(now - 1000) }, now)).toBe("expired");
    expect(
      inviteStatus({ expiresAt: new Date(now + 1000), usedAt: new Date() }, now),
    ).toBe("used");
    expect(
      inviteStatus({ expiresAt: new Date(now + 1000), revokedAt: new Date() }, now),
    ).toBe("revoked");
  });
});
