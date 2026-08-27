"use client";
import { useCallback, useEffect, useState } from "react";
import { SyncIcon, FileIcon, LinkExternalIcon, ClockIcon } from "@primer/octicons-react";
import { useToast } from "@/components/Toast";
import { Spinner } from "@/components/projectForms";
import Markdown from "@/components/Markdown";
import { describeAge, isStale } from "@/lib/pullRequests";

function modified(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AdrBoard({ projectId }) {
  const toast = useToast();
  const [data, setData] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/adrs`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load ADRs");
      setData(json);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function refresh() {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/adrs/refresh`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.fields?.[0]?.message || json.error || "Refresh failed");
      }
      setData(json);
      setError(null);
      // Keep the open record open across a refresh if it still exists.
      setSelected((cur) =>
        cur ? json.adrs.find((a) => a.path === cur.path) ?? null : null
      );
      toast.success(`Refreshed ${json.adrs.length} records.`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
        {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center py-16 text-muted">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  const stale = isStale(data.refreshedAt);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-normal text-fg">Decision records</h1>
          <p className="mt-1 text-sm text-muted">
            {data.source ? (
              <>
                {data.adrs.length} record{data.adrs.length === 1 ? "" : "s"} from{" "}
                <span className="font-medium text-fg">
                  {data.source.repo}/{data.source.path}
                </span>
                {" · "}
                refreshed {describeAge(data.refreshedAt)}
                {data.refreshedBy && ` by ${data.refreshedBy}`}
              </>
            ) : (
              "No source folder configured."
            )}
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={busy}
          className="btn inline-flex items-center gap-2 px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {busy ? <Spinner className="h-4 w-4" /> : <SyncIcon size={16} />}
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {stale && data.refreshedAt && (
        <div className="flex items-start gap-2 rounded-md border border-attention/40 bg-attention/10 px-3 py-2 text-xs text-fg">
          <span className="mt-0.5 text-attention">
            <ClockIcon size={16} />
          </span>
          <span>
            This was read {describeAge(data.refreshedAt)}. Records may have been
            added or changed in the repository since — refresh to bring them up
            to date.
          </span>
        </div>
      )}

      {data.adrs.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted">
          {data.refreshedAt
            ? "No markdown files found in that folder."
            : "Nothing cached yet — press Refresh to read them from GitHub."}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <ul className="gh-card divide-y divide-border overflow-hidden lg:sticky lg:top-4 lg:self-start">
            {data.adrs.map((adr) => {
              const active = selected?.path === adr.path;
              return (
                <li key={adr.id}>
                  <button
                    onClick={() => setSelected(active ? null : adr)}
                    aria-current={active}
                    className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-subtle ${
                      active ? "bg-subtle" : ""
                    }`}
                  >
                    <span className="mt-0.5 shrink-0 text-muted">
                      <FileIcon size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">
                        {adr.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted">
                        {adr.fileName}
                        {adr.lastModifiedAt && ` · ${modified(adr.lastModifiedAt)}`}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="min-w-0">
            {selected ? (
              <article className="gh-card px-5 py-4">
                <div className="mb-3 flex items-start justify-between gap-3 border-b border-border pb-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-fg">
                      {selected.title}
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {selected.path}
                      {selected.lastModifiedAt &&
                        ` · last changed ${modified(selected.lastModifiedAt)}`}
                    </p>
                  </div>
                  {selected.url && (
                    <a
                      href={selected.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1 text-xs"
                    >
                      <LinkExternalIcon size={14} />
                      GitHub
                    </a>
                  )}
                </div>
                {selected.body ? (
                  <Markdown>{selected.body}</Markdown>
                ) : (
                  <p className="text-sm text-muted">
                    This file was too large for GitHub to return inline. Open it
                    on GitHub to read it.
                  </p>
                )}
              </article>
            ) : (
              <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted">
                Select a record to read it.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
