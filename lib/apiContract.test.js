import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards a failure mode that is invisible at runtime.
 *
 * API routes are thin pass-throughs that pick named fields off the request
 * body. If the data layer grows a field and its route isn't updated, the field
 * is silently dropped: `updateProject` sees `undefined`, treats it as "not
 * supplied", takes its no-op branch and returns 200. The client shows a success
 * message and nothing has changed. (This is exactly how the welcome page
 * shipped broken.)
 *
 * Rather than duplicating the field lists, the expectations are derived from
 * the data-layer function signatures, so adding a field there fails this test
 * until the route forwards it.
 */

const root = resolve(__dirname, "..");
const dataLayer = readFileSync(resolve(root, "lib/db/projects.js"), "utf8");

// Which route file is responsible for calling which data-layer function.
const CONTRACTS = [
  { route: "app/api/projects/route.js", fn: "createProject" },
  { route: "app/api/projects/[id]/route.js", fn: "updateProject" },
  { route: "app/api/projects/[id]/repos/route.js", fn: "addRepo" },
  { route: "app/api/projects/[id]/boards/route.js", fn: "addBoard" },
  { route: "app/api/projects/[id]/environments/route.js", fn: "addEnvironment" },
  {
    route: "app/api/projects/[id]/environments/[environmentId]/route.js",
    fn: "updateEnvironment",
  },
  {
    route: "app/api/projects/[id]/environments/[environmentId]/claim/route.js",
    fn: "claimEnvironment",
  },
  { route: "app/api/projects/[id]/collaborators/route.js", fn: "addCollaborator" },
  { route: "app/api/admin/super-admins/route.js", fn: "addSuperAdmin" },
];

/** Field names in a function's `{ a, b } = {}` options parameter. */
function optionFields(source, fnName) {
  const start = source.indexOf(`export async function ${fnName}(`);
  if (start === -1) throw new Error(`${fnName} not found in lib/db/projects.js`);
  const open = source.indexOf("(", start);
  const body = source.indexOf("{", source.indexOf(")", open));
  const params = source.slice(open + 1, body);

  const match = params.match(/\{([^}]*)\}\s*=\s*\{\}/);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("API routes forward every field the data layer accepts", () => {
  for (const { route, fn } of CONTRACTS) {
    it(`${route} → ${fn}()`, () => {
      const fields = optionFields(dataLayer, fn);
      expect(fields.length).toBeGreaterThan(0);

      const source = readFileSync(resolve(root, route), "utf8");
      const forwarded = fields.filter((f) => source.includes(`body.${f}`));

      expect(forwarded.sort()).toEqual(fields.sort());
    });
  }
});
