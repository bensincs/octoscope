import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sprintState, extractFields, getProjectFields } from "./github.js";

describe("sprintState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Fix "now" to 2025-06-15 UTC for deterministic comparisons.
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("returns 'unknown' when there is no start date", () => {
    expect(sprintState(null, 14)).toBe("unknown");
    expect(sprintState(undefined, 14)).toBe("unknown");
    expect(sprintState("", 14)).toBe("unknown");
  });

  it("classifies a sprint that already ended as 'past'", () => {
    // 2025-06-01 + 7 days = ends 2025-06-08 → before 06-15.
    expect(sprintState("2025-06-01", 7)).toBe("past");
  });

  it("classifies a sprint that hasn't started as 'future'", () => {
    expect(sprintState("2025-07-01", 14)).toBe("future");
  });

  it("classifies the active sprint as 'current'", () => {
    // 2025-06-10 + 14 days = ends 2025-06-24 → 06-15 falls inside.
    expect(sprintState("2025-06-10", 14)).toBe("current");
  });

  it("treats the end boundary as past (today >= end)", () => {
    // 2025-06-01 + 14 = ends 2025-06-15 == today → past.
    expect(sprintState("2025-06-01", 14)).toBe("past");
  });

  it("treats the start boundary as current (today >= start)", () => {
    // Starts exactly today, duration 1 → current.
    expect(sprintState("2025-06-15", 1)).toBe("current");
  });

  it("defaults a missing duration to 0 (zero-length → past)", () => {
    expect(sprintState("2025-06-10")).toBe("past");
  });
});

describe("extractFields", () => {
  it("reads Status from a single-select field named 'status'", () => {
    const item = {
      fieldValues: {
        nodes: [
          {
            __typename: "ProjectV2ItemFieldSingleSelectValue",
            name: "In Progress",
            field: { name: "Status" },
          },
        ],
      },
    };
    expect(extractFields(item)).toEqual({
      status: "In Progress",
      sprint: null,
    });
  });

  it("extracts an iteration field into a sprint with computed state", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
    const item = {
      fieldValues: {
        nodes: [
          {
            __typename: "ProjectV2ItemFieldIterationValue",
            title: "Sprint 12",
            startDate: "2025-06-10",
            duration: 14,
            field: { name: "Sprint" },
          },
        ],
      },
    };
    expect(extractFields(item)).toEqual({
      status: null,
      sprint: { name: "Sprint 12", state: "current" },
    });
    vi.useRealTimers();
  });

  it("returns null status/sprint when there are no field values", () => {
    expect(extractFields({})).toEqual({ status: null, sprint: null });
    expect(extractFields({ fieldValues: { nodes: [] } })).toEqual({
      status: null,
      sprint: null,
    });
  });

  it("prefers the field literally named 'status' over other single-selects", () => {
    const item = {
      fieldValues: {
        nodes: [
          {
            __typename: "ProjectV2ItemFieldSingleSelectValue",
            name: "High",
            field: { name: "Priority" },
          },
          {
            __typename: "ProjectV2ItemFieldSingleSelectValue",
            name: "Done",
            field: { name: "Status" },
          },
        ],
      },
    };
    expect(extractFields(item).status).toBe("Done");
  });

  it("falls back to the first single-select when none is named 'status'", () => {
    const item = {
      fieldValues: {
        nodes: [
          {
            __typename: "ProjectV2ItemFieldSingleSelectValue",
            name: "High",
            field: { name: "Priority" },
          },
        ],
      },
    };
    expect(extractFields(item).status).toBe("High");
  });
});

describe("getProjectFields owner resolution", () => {
  // Build a fetch mock that answers per GraphQL root. `roots` maps
  // "organization"/"user" → a value: an object becomes the resolved project
  // (data[root].projectV2), an array becomes the GraphQL `errors` (data[root]
  // = null).
  function mockFetch(roots) {
    return vi.fn(async (_url, opts) => {
      const { query } = JSON.parse(opts.body);
      const root = /organization\(login:/.test(query) ? "organization" : "user";
      const answer = roots[root];
      const body = Array.isArray(answer)
        ? { data: { [root]: null }, errors: answer }
        : { data: { [root]: { projectV2: answer } } };
      return { ok: true, status: 200, json: async () => body };
    });
  }

  const PROJECT = {
    title: "Roadmap",
    url: "https://github.com/orgs/cortex-inception/projects/2",
    items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
  };

  afterEach(() => vi.unstubAllGlobals());

  it("resolves an org board regardless of which root the login lives under", async () => {
    // The login is an org; we shouldn't need to be told that up front.
    vi.stubGlobal(
      "fetch",
      mockFetch({
        user: [{ type: "NOT_FOUND", message: "Could not resolve to a User." }],
        organization: PROJECT,
      })
    );
    const result = await getProjectFields("tok", "cortex-inception", 2);
    expect(result.ownerResolved).toBe(true);
    expect(result.project).toEqual({ title: "Roadmap", url: PROJECT.url });
  });

  it("surfaces an SSO/access error instead of a misleading 'not found'", async () => {
    const sso =
      "Although you appear to have the correct authorization credentials, " +
      "the `cortex-inception` organization has enabled SAML SSO.";
    vi.stubGlobal(
      "fetch",
      mockFetch({
        organization: [{ type: "FORBIDDEN", message: sso }],
        user: [{ type: "NOT_FOUND", message: "Could not resolve to a User." }],
      })
    );
    await expect(
      getProjectFields("tok", "cortex-inception", 2)
    ).rejects.toThrow(sso);
  });

  it("keeps the generic 'not found' message when the login truly doesn't exist", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        organization: [
          { type: "NOT_FOUND", message: "Could not resolve to an Organization." },
        ],
        user: [{ type: "NOT_FOUND", message: "Could not resolve to a User." }],
      })
    );
    await expect(
      getProjectFields("tok", "ghost-login", 2)
    ).rejects.toThrow('Couldn\'t find a user or organization named "ghost-login".');
  });
});
