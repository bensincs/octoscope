import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Every name a route imports from the data layer must actually be exported.
 *
 * This exists because two features shipped broken. Their data-layer functions
 * were never added, and nothing caught it: Next.js resolves a missing named
 * export to `undefined` rather than failing the build, the routes are not unit
 * tested, and the failure only appears when a user triggers that exact path.
 *
 * A build that succeeds is not evidence the code it built is wired up.
 */
const root = resolve(__dirname, "..");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === "route.js") out.push(full);
  }
  return out;
}

const routes = walk(join(root, "app", "api"));
const dataLayer = readFileSync(join(root, "lib", "db", "projects.js"), "utf8");

const exported = new Set(
  [...dataLayer.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map(
    (m) => m[1],
  ),
);
// Error classes are re-exported rather than declared as functions.
for (const m of dataLayer.matchAll(/^export\s*\{([^}]+)\}/gm)) {
  for (const name of m[1].split(",")) exported.add(name.trim());
}

describe("route imports from lib/db/projects", () => {
  it("finds route files to check", () => {
    expect(routes.length).toBeGreaterThan(5);
  });

  for (const file of routes) {
    const source = readFileSync(file, "utf8");
    const match = source.match(
      /import\s*\{([^}]+)\}\s*from\s*"@\/lib\/db\/projects"/s,
    );
    if (!match) continue;

    const names = match[1]
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);

    it(`${file.slice(root.length + 1)} imports only names that exist`, () => {
      const missing = names.filter((n) => !exported.has(n));
      expect(missing).toEqual([]);
    });
  }
});
