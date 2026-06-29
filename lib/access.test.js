import { describe, it, expect } from "vitest";
import {
  ROLES,
  ROLE_RANK,
  isAssignableRole,
  meetsRole,
  effectiveRole,
  isSelfAdminRow,
} from "./access.js";

describe("ROLES / ROLE_RANK", () => {
  it("exposes the three assignable collaborator roles (owner is implicit)", () => {
    expect(ROLES).toEqual(["viewer", "editor", "admin"]);
    expect(ROLES).not.toContain("owner");
  });

  it("ranks roles in ascending capability order", () => {
    expect(ROLE_RANK.viewer).toBeLessThan(ROLE_RANK.editor);
    expect(ROLE_RANK.editor).toBeLessThan(ROLE_RANK.admin);
    expect(ROLE_RANK.admin).toBeLessThan(ROLE_RANK.owner);
  });
});

describe("isAssignableRole", () => {
  it("accepts the assignable roles", () => {
    expect(isAssignableRole("viewer")).toBe(true);
    expect(isAssignableRole("editor")).toBe(true);
    expect(isAssignableRole("admin")).toBe(true);
  });

  it("rejects owner and unknown/blank values", () => {
    expect(isAssignableRole("owner")).toBe(false);
    expect(isAssignableRole("superuser")).toBe(false);
    expect(isAssignableRole("")).toBe(false);
    expect(isAssignableRole(undefined)).toBe(false);
    expect(isAssignableRole(null)).toBe(false);
  });
});

describe("meetsRole", () => {
  it("passes when the role equals the requirement", () => {
    expect(meetsRole("viewer", "viewer")).toBe(true);
    expect(meetsRole("admin", "admin")).toBe(true);
    expect(meetsRole("owner", "owner")).toBe(true);
  });

  it("passes when the role exceeds the requirement", () => {
    expect(meetsRole("editor", "viewer")).toBe(true);
    expect(meetsRole("admin", "editor")).toBe(true);
    expect(meetsRole("owner", "admin")).toBe(true);
  });

  it("fails when the role is below the requirement", () => {
    expect(meetsRole("viewer", "editor")).toBe(false);
    expect(meetsRole("editor", "admin")).toBe(false);
    expect(meetsRole("admin", "owner")).toBe(false);
  });

  it("gates the canonical capabilities", () => {
    // viewers run audits but can't edit
    expect(meetsRole("viewer", "viewer")).toBe(true);
    expect(meetsRole("viewer", "editor")).toBe(false);
    // editors manage repos/boards/rulebook but not collaborators
    expect(meetsRole("editor", "editor")).toBe(true);
    expect(meetsRole("editor", "admin")).toBe(false);
    // admins manage collaborators but can't delete the project
    expect(meetsRole("admin", "admin")).toBe(true);
    expect(meetsRole("admin", "owner")).toBe(false);
    // owners can do everything
    expect(meetsRole("owner", "owner")).toBe(true);
  });

  it("never satisfies for unknown roles or requirements", () => {
    expect(meetsRole("nope", "viewer")).toBe(false);
    expect(meetsRole("admin", "nope")).toBe(false);
    expect(meetsRole(undefined, "viewer")).toBe(false);
    expect(meetsRole("admin", undefined)).toBe(false);
  });
});

describe("effectiveRole", () => {
  it("makes an owner owner-equivalent", () => {
    expect(effectiveRole({ isOwner: true })).toBe("owner");
    // Owner wins even if (somehow) also a collaborator.
    expect(effectiveRole({ isOwner: true, collabRole: "viewer" })).toBe("owner");
  });

  it("makes a super admin owner-equivalent on any project", () => {
    // Not the owner, not a collaborator — super admin still gets owner.
    expect(effectiveRole({ isSuperAdmin: true })).toBe("owner");
    expect(effectiveRole({ collabRole: null, isSuperAdmin: true })).toBe("owner");
    // Super admin overrides a lesser collaborator role.
    expect(effectiveRole({ collabRole: "viewer", isSuperAdmin: true })).toBe("owner");
  });

  it("falls back to the collaborator role when neither owner nor super admin", () => {
    expect(effectiveRole({ collabRole: "viewer" })).toBe("viewer");
    expect(effectiveRole({ collabRole: "editor" })).toBe("editor");
    expect(effectiveRole({ collabRole: "admin" })).toBe("admin");
  });

  it("returns null when the caller has no access at all", () => {
    expect(effectiveRole({})).toBeNull();
    expect(effectiveRole({ isOwner: false, collabRole: null, isSuperAdmin: false })).toBeNull();
  });
});

describe("isSelfAdminRow", () => {
  it("matches by linked user id", () => {
    const row = { userId: "u1", login: "octocat" };
    expect(isSelfAdminRow(row, { id: "u1", login: "someoneelse" })).toBe(true);
    expect(isSelfAdminRow(row, { id: "u2", login: "someoneelse" })).toBe(false);
  });

  it("matches by login (case-insensitive) for pending rows with no user id", () => {
    const pending = { userId: null, login: "octocat" };
    expect(isSelfAdminRow(pending, { id: "u1", login: "OctoCat" })).toBe(true);
    expect(isSelfAdminRow(pending, { id: "u1", login: "hubber" })).toBe(false);
  });

  it("is null-safe for missing row or caller", () => {
    expect(isSelfAdminRow(null, { id: "u1", login: "x" })).toBe(false);
    expect(isSelfAdminRow({ userId: "u1", login: "x" }, null)).toBe(false);
    expect(isSelfAdminRow({ userId: null, login: "x" }, { id: "u1" })).toBe(false);
  });
});
