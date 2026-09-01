import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const ROOT = resolve(__dirname, "..");

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.jsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

const IMPORT_RE = /^\s*(?:import|export)[^'"]*from\s+["']([^"']+)["']/gm;

function importsOf(file) {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(IMPORT_RE)].map((m) => m[1]);
}

function resolveLocal(spec, from) {
  let base;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null; // bare package, not ours to inspect
  for (const c of [base, `${base}.js`, `${base}.jsx`, join(base, "index.js")]) {
    if (existsSync(c) && /\.jsx?$/.test(c)) return c;
  }
  return null;
}

/** Walk a client component's own modules and report any Node builtin reached. */
function serverOnlyReachableFrom(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importsOf(file)) {
      if (spec.startsWith("node:")) {
        return { file, spec };
      }
      const next = resolveLocal(spec, file);
      if (next) stack.push(next);
    }
  }
  return null;
}

const clientFiles = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))].filter(
  (f) => /^["']use client["']/.test(readFileSync(f, "utf8").trimStart()),
);

describe("client bundle", () => {
  it("finds the client components", () => {
    expect(clientFiles.length).toBeGreaterThan(5);
  });

  // A client component that reaches a Node builtin breaks in the browser, and
  // the build does not always stop it. lib/invites.js imports node:crypto and
  // sits one careless import away from every settings panel, which is why the
  // durations it shares with the UI live in their own module.
  it("no client component reaches a node: builtin", () => {
    const bad = clientFiles
      .map((f) => {
        const hit = serverOnlyReachableFrom(f);
        return hit && `${f.replace(ROOT + "/", "")} -> ${hit.file.replace(ROOT + "/", "")} imports ${hit.spec}`;
      })
      .filter(Boolean);
    expect(bad).toEqual([]);
  });
});
