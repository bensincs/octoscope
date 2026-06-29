import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the auth module so importing session.js doesn't pull in NextAuth / pg.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/lib/auth";
import {
  resolveToken,
  getToken,
  getUserId,
  PAT_HEADER,
} from "@/lib/session";

// Build a fake Request-like object with a headers.get() shim.
function req(headers = {}) {
  return {
    headers: {
      get: (key) => headers[key] ?? null,
    },
  };
}

beforeEach(() => {
  vi.mocked(auth).mockReset();
});

describe("session / resolveToken", () => {
  it("prefers a PAT from the request header over the session", async () => {
    vi.mocked(auth).mockResolvedValue({ accessToken: "oauth-token" });
    const token = await resolveToken(req({ [PAT_HEADER]: "ghp_pat" }));
    expect(token).toBe("ghp_pat");
    // PAT short-circuits — the session is never consulted.
    expect(auth).not.toHaveBeenCalled();
  });

  it("trims whitespace around a PAT header", async () => {
    const token = await resolveToken(req({ [PAT_HEADER]: "  ghp_spaced  " }));
    expect(token).toBe("ghp_spaced");
  });

  it("falls back to the OAuth session token when no PAT is present", async () => {
    vi.mocked(auth).mockResolvedValue({ accessToken: "oauth-token" });
    const token = await resolveToken(req());
    expect(token).toBe("oauth-token");
  });

  it("ignores an empty/whitespace-only PAT header and uses the session", async () => {
    vi.mocked(auth).mockResolvedValue({ accessToken: "oauth-token" });
    const token = await resolveToken(req({ [PAT_HEADER]: "   " }));
    expect(token).toBe("oauth-token");
  });

  it("returns null when there is neither a PAT nor a session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    expect(await resolveToken(req())).toBeNull();
  });

  it("handles a missing request object gracefully", async () => {
    vi.mocked(auth).mockResolvedValue({ accessToken: "oauth-token" });
    expect(await resolveToken(undefined)).toBe("oauth-token");
  });
});

describe("session / getToken", () => {
  it("returns the session access token", async () => {
    vi.mocked(auth).mockResolvedValue({ accessToken: "abc" });
    expect(await getToken()).toBe("abc");
  });

  it("returns null when not signed in", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    expect(await getToken()).toBeNull();
  });
});

describe("session / getUserId", () => {
  it("returns the app user id from the session", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-123" } });
    expect(await getUserId()).toBe("user-123");
  });

  it("returns null when the session has no user", async () => {
    vi.mocked(auth).mockResolvedValue({});
    expect(await getUserId()).toBeNull();
  });
});
