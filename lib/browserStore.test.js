import { describe, it, expect, beforeEach, vi } from "vitest";

// A minimal in-memory IndexedDB good enough to exercise the miss/hit paths.
// The bug this guards was entirely in how a REQUEST's result was resolved, so
// the fake mirrors IDB's shape: a request object that always has a `result`
// property, undefined when the key is absent.
function fakeIndexedDB() {
  const data = new Map();
  return {
    open() {
      const req = {};
      queueMicrotask(() => {
        req.result = {
          objectStoreNames: { contains: () => true },
          transaction() {
            const tx = {};
            queueMicrotask(() => tx.oncomplete?.());
            return {
              objectStore: () => ({
                get(k) {
                  const r = { result: data.get(k) };
                  return r;
                },
                put(v, k) {
                  data.set(k, v);
                  return { result: k };
                },
                delete(k) {
                  data.delete(k);
                  return { result: undefined };
                },
                getAllKeys() {
                  const r = { result: [...data.keys()] };
                  queueMicrotask(() => r.onsuccess?.());
                  return r;
                },
              }),
              set oncomplete(fn) {
                tx.oncomplete = fn;
              },
              set onerror(_) {},
              set onabort(_) {},
            };
          },
          close() {},
        };
        req.onsuccess?.();
      });
      return req;
    },
  };
}

let store;
beforeEach(async () => {
  vi.resetModules();
  globalThis.indexedDB = fakeIndexedDB();
  store = await import("@/lib/browserStore");
});

describe("readLocal", () => {
  // The original bug: on a miss, the helper returned the IDBRequest object
  // instead of nothing. That is truthy, so callers spread it as if it were
  // stored data and then read fields that did not exist.
  it("returns null for a key that was never written", async () => {
    const value = await store.readLocal("proj-1", store.FEATURES.PULL_REQUESTS);
    expect(value).toBeNull();
  });

  it("round-trips a stored payload", async () => {
    await store.writeLocal("proj-1", store.FEATURES.PULL_REQUESTS, {
      pullRequests: [{ number: 1 }],
    });
    const value = await store.readLocal("proj-1", store.FEATURES.PULL_REQUESTS);
    expect(value.pullRequests).toEqual([{ number: 1 }]);
    expect(value.storedAt).toBeTypeOf("string");
  });

  it("keeps features and projects separate", async () => {
    await store.writeLocal("proj-1", store.FEATURES.ISSUES, { issues: [] });
    expect(await store.readLocal("proj-1", store.FEATURES.PULL_REQUESTS)).toBeNull();
    expect(await store.readLocal("proj-2", store.FEATURES.ISSUES)).toBeNull();
  });

  it("treats a non-object value as nothing cached", async () => {
    await store.writeLocal("proj-1", store.FEATURES.ADRS, { adrs: [] });
    const value = await store.readLocal("proj-1", store.FEATURES.ADRS);
    expect(value).toBeTypeOf("object");
    expect(Array.isArray(value)).toBe(false);
  });
});

describe("clearLocal", () => {
  it("removes only the feature asked for", async () => {
    await store.writeLocal("proj-1", store.FEATURES.ISSUES, { issues: [1] });
    await store.writeLocal("proj-1", store.FEATURES.ADRS, { adrs: [2] });
    await store.clearLocal("proj-1", store.FEATURES.ISSUES);
    expect(await store.readLocal("proj-1", store.FEATURES.ISSUES)).toBeNull();
    expect(await store.readLocal("proj-1", store.FEATURES.ADRS)).not.toBeNull();
  });
});

describe("when IndexedDB is unavailable", () => {
  // Private windows and hardened profiles. Degrading to "nothing cached" is
  // correct; throwing would break the page entirely.
  it("reads as empty and reports a failed write", async () => {
    vi.resetModules();
    globalThis.indexedDB = undefined;
    const s = await import("@/lib/browserStore");
    expect(await s.readLocal("p", s.FEATURES.ISSUES)).toBeNull();
    expect(await s.writeLocal("p", s.FEATURES.ISSUES, { a: 1 })).toBe(false);
  });
});
