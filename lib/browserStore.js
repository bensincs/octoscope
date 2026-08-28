// Browser-local storage for GitHub-derived data.
//
// Used when a project has `localOnlyGithubData` set: the server fetches from
// GitHub (the PATs live server-side and must stay there) but persists nothing,
// and the response is kept here in the reader's own browser instead.
//
// IndexedDB rather than localStorage: an issue snapshot for a busy repository
// runs to megabytes, comfortably past localStorage's ~5MB cap, and localStorage
// is synchronous so serialising one would block the main thread.
//
// Hand-rolled rather than a library (PouchDB, idb-keyval) on purpose. The
// access pattern is one blob per project per feature — read, write, delete —
// which needs none of what a library adds, and for a data-protection control it
// is worth being able to read exactly what gets written and where.

const DB_NAME = "octoscope-local";
const STORE = "github-data";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser has no IndexedDB."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open IndexedDB."));
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;
      try {
        result = fn(store);
      } catch (e) {
        reject(e);
        return;
      }
      tx.oncomplete = () => resolve(result?.result ?? result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted."));
    });
  } finally {
    db.close();
  }
}

/** Namespaced so one project's data can be cleared without touching another's. */
function key(projectId, feature) {
  return `${projectId}:${feature}`;
}

/**
 * Read a cached payload, or null.
 *
 * Never throws: a browser with IndexedDB disabled (private mode in some
 * browsers, or a hardened profile) should degrade to "nothing cached, press
 * Refresh" rather than breaking the page.
 */
export async function readLocal(projectId, feature) {
  try {
    const value = await withStore("readonly", (store) => store.get(key(projectId, feature)));
    return value ?? null;
  } catch {
    return null;
  }
}

/**
 * Write a payload. Returns false when storage is unavailable or the quota is
 * exceeded, so the caller can tell the user their data is in memory only rather
 * than silently losing it on reload.
 */
export async function writeLocal(projectId, feature, value) {
  try {
    await withStore("readwrite", (store) =>
      store.put({ ...value, storedAt: new Date().toISOString() }, key(projectId, feature)),
    );
    return true;
  } catch {
    return false;
  }
}

/** Remove one feature's data for a project. */
export async function clearLocal(projectId, feature) {
  try {
    await withStore("readwrite", (store) => store.delete(key(projectId, feature)));
  } catch {
    // Nothing to do — the data is already unreachable.
  }
}

/**
 * Remove everything this project has stored locally.
 *
 * Called when the setting is switched off, so that turning local-only mode off
 * doesn't quietly leave GitHub content sitting in browsers.
 */
export async function clearProjectLocal(projectId) {
  try {
    await withStore("readwrite", (store) => {
      const req = store.getAllKeys();
      req.onsuccess = () => {
        for (const k of req.result ?? []) {
          if (String(k).startsWith(`${projectId}:`)) store.delete(k);
        }
      };
      return req;
    });
  } catch {
    // Same as above.
  }
}

export const FEATURES = {
  ISSUES: "issues",
  PULL_REQUESTS: "pull-requests",
  ADRS: "adrs",
};
