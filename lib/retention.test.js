import { describe, it, expect } from "vitest";
import {
  validateRetention,
  cutoffFor,
  isExpired,
  describeRetention,
} from "@/lib/retention";

describe("validateRetention", () => {
  it("accepts whole numbers of days", () => {
    expect(validateRetention(30)).toMatchObject({ ok: true, value: 30 });
    expect(validateRetention("7")).toMatchObject({ ok: true, value: 7 });
  });

  it("treats blank as unlimited", () => {
    for (const v of [null, undefined, ""]) {
      expect(validateRetention(v)).toMatchObject({ ok: true, value: null });
    }
  });

  // Deleting data the instant it is written is far likelier to be a mistake
  // than an intention.
  it("rejects zero and negatives", () => {
    expect(validateRetention(0).ok).toBe(false);
    expect(validateRetention(-1).ok).toBe(false);
  });

  it("rejects fractions and nonsense", () => {
    expect(validateRetention(1.5).ok).toBe(false);
    expect(validateRetention("soon").ok).toBe(false);
  });

  it("caps absurd values", () => {
    expect(validateRetention(3650).ok).toBe(true);
    expect(validateRetention(3651).ok).toBe(false);
  });
});

describe("isExpired", () => {
  const now = Date.UTC(2026, 0, 31, 12, 0, 0);
  const ago = (days) => new Date(now - days * 86400000);

  it("never expires without a policy", () => {
    expect(isExpired(ago(3650), null, now)).toBe(false);
    expect(isExpired(ago(3650), undefined, now)).toBe(false);
  });

  it("expires strictly past the window", () => {
    expect(isExpired(ago(6.9), 7, now)).toBe(false);
    expect(isExpired(ago(7.1), 7, now)).toBe(true);
  });

  // A missing or unreadable timestamp must not cause data to vanish.
  it("does not expire missing or unparseable timestamps", () => {
    expect(isExpired(null, 7, now)).toBe(false);
    expect(isExpired("nonsense", 7, now)).toBe(false);
  });
});

describe("cutoffFor", () => {
  const now = Date.UTC(2026, 0, 31, 12, 0, 0);

  it("is null without a policy", () => {
    expect(cutoffFor(null, now)).toBeNull();
  });

  it("is the window's start", () => {
    expect(cutoffFor(7, now).getTime()).toBe(now - 7 * 86400000);
  });
});

describe("describeRetention", () => {
  it("reads naturally", () => {
    expect(describeRetention(null)).toBe("kept until replaced by a refresh");
    expect(describeRetention(1)).toBe("deleted after 1 day");
    expect(describeRetention(30)).toBe("deleted after 30 days");
  });
});
