"use client";
import { useCallback, useEffect, useState } from "react";
import {
  SyncIcon,
  GitPullRequestIcon,
  ChevronRightIcon,
  XCircleIcon,
  AlertIcon,
  ArrowUpIcon,
  QuestionIcon,
  ClockIcon,
} from "@primer/octicons-react";
import { useToast } from "@/components/Toast";
import { readLocal, writeLocal, FEATURES } from "@/lib/browserStore";
import { Spinner } from "@/components/projectForms";
import {
  groupByAuthor,
  describeAge,
  isStale,
  annotatePullRequests,
  PR_FLAGS,
  PR_FLAG_LABELS,
} from "@/lib/pullRequests";

const FLAG_STYLE = {
  [PR_FLAGS.FAILING_CHECKS]: {
    icon: XCircleIcon,
    className: "border-danger/40 bg-danger/10 text-danger",
  },
  [PR_FLAGS.MERGE_CONFLICT]: {
    icon: AlertIcon,
    className: "border-danger/40 bg-danger/10 text-danger",
  },
  [PR_FLAGS.BEHIND_BASE]: {
    icon: ArrowUpIcon,
    className: "border-attention/40 bg-attention/10 text-attention",
  },
};

function FlagBadge({ flag }) {
  const style = FLAG_STYLE[flag];
  if (!style) return null;
  const Icon = style.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${style.className}`}
    >
      <Icon size={12} />
      {PR_FLAG_LABELS[flag]}
    </span>
  );
}

function prAge(iso) {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export default function PullRequestsBoard({ projectId, localOnly = false }) {
  const toast = useToast();
  const [data, setData] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(() => new Set());
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/pull-requests`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load pull requests");

      // In local-only mode the server holds nothing, so the cached copy comes
      // from this browser. The server response still supplies the rulebook,
      // which is configuration rather than GitHub data.
      if (json.localOnly) {
        const local = await readLocal(projectId, FEATURES.PULL_REQUESTS);
        setData(local ? { ...local, config: json.config, localOnly: true } : json);
      } else {
        setData(json);
      }
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
      const res = await fetch(`/api/projects/${projectId}/pull-requests/refresh`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.fields?.[0]?.message || json.error || "Refresh failed");
      }
      if (json.localOnly) {
        const stored = await writeLocal(projectId, FEATURES.PULL_REQUESTS, json);
        if (!stored) {
          toast.error(
            "Couldn't save to this browser — the data is in memory and will be lost on reload."
          );
        }
      }
      setData(json);
      setError(null);
      // A partial refresh still succeeds — surface which repos didn't come back
      // rather than quietly showing stale data for them.
      if (json.errors?.length) {
        toast.error(
          `Refreshed, but ${json.errors.length} repo${
            json.errors.length > 1 ? "s" : ""
          } failed: ${json.errors.map((e) => e.repo).join(", ")}`
        );
      } else {
        toast.success(
          `Refreshed ${json.pullRequests?.length ?? 0} open pull requests.`
        );
      }
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

  // Flags are computed from the CURRENT rulebook against cached PR state, so
  // toggling a rule in Settings takes effect without another GitHub fetch.
  const rows = Array.isArray(data.pullRequests) ? data.pullRequests : [];
  const annotated = annotatePullRequests(rows, data.config);
  const flaggedTotal = annotated.filter((pr) => pr.flags.length > 0).length;
  const visible = onlyFlagged ? annotated.filter((pr) => pr.flags.length > 0) : annotated;
  const groups = groupByAuthor(visible);
  const stale = isStale(data.refreshedAt);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-normal text-fg">Pull requests</h1>
          <p className="mt-1 text-sm text-muted">
            {rows.length} open across your connected repositories
            {" · "}
            <span className={stale ? "text-attention" : undefined}>
              refreshed {describeAge(data.refreshedAt)}
            </span>
            {data.refreshedBy && ` by ${data.refreshedBy}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {flaggedTotal > 0 && (
            <button
              onClick={() => setOnlyFlagged((v) => !v)}
              aria-pressed={onlyFlagged}
              className={`btn px-3 py-1.5 text-sm ${
                onlyFlagged ? "border-accent text-accent" : ""
              }`}
            >
              {onlyFlagged ? "Show all" : `Needs attention (${flaggedTotal})`}
            </button>
          )}
          <button
            onClick={refresh}
            disabled={busy}
            className="btn inline-flex items-center gap-2 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {busy ? <Spinner className="h-4 w-4" /> : <SyncIcon size={16} />}
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {data.localOnly && (
        <p className="rounded-md border border-border bg-subtle px-3 py-2 text-xs text-muted">
          This project keeps GitHub data out of the database — what you see is
          stored in this browser only, so refreshing updates it for you alone.
        </p>
      )}

      {stale && data.refreshedAt && (
        <div className="flex items-start gap-2 rounded-md border border-attention/40 bg-attention/10 px-3 py-2 text-xs text-fg">
          <span className="mt-0.5 text-attention">
            <ClockIcon size={16} />
          </span>
          <span>
            This data was fetched {describeAge(data.refreshedAt)}. Check results
            and merge status change as branches move — refresh to bring them up
            to date.
          </span>
        </div>
      )}

      {data.errors?.length > 0 && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          Some repositories could not be refreshed and are showing older data:
          <ul className="mt-1 list-disc pl-5">
            {data.errors.map((e) => (
              <li key={e.repo}>
                <span className="font-semibold">{e.repo}</span> — {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted">
          {onlyFlagged
            ? "Nothing needs attention."
            : data.refreshedAt
              ? "No open pull requests."
              : "Nothing cached yet — press Refresh to fetch from GitHub."}
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const expanded = open.has(g.login);
            return (
              <div key={g.login} className="gh-card overflow-hidden">
                <button
                  onClick={() =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      next.has(g.login) ? next.delete(g.login) : next.add(g.login);
                      return next;
                    })
                  }
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-subtle"
                >
                  <span
                    className="text-muted transition-transform"
                    style={{ transform: expanded ? "rotate(90deg)" : undefined }}
                  >
                    <ChevronRightIcon size={16} />
                  </span>
                  {g.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={g.avatarUrl} alt="" className="h-6 w-6 rounded-full" />
                  ) : (
                    <span className="h-6 w-6 rounded-full bg-subtle" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
                    {g.login}
                  </span>
                  {g.flagged > 0 && (
                    <span className="rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 text-[11px] font-semibold text-danger">
                      {g.flagged} needs attention
                    </span>
                  )}
                  {g.drafts > 0 && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
                      {g.drafts} draft
                    </span>
                  )}
                  <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-semibold text-fg">
                    {g.total}
                  </span>
                </button>

                {expanded && (
                  <ul className="divide-y divide-border border-t border-border">
                    {g.pullRequests.map((pr) => (
                      <li key={pr.id} className="flex items-start gap-2.5 px-4 py-2.5">
                        <span
                          className={pr.isDraft ? "mt-0.5 text-muted" : "mt-0.5 text-success"}
                        >
                          <GitPullRequestIcon size={16} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <a
                            href={pr.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-fg hover:text-accent hover:underline"
                          >
                            {pr.title}
                          </a>
                          <p className="mt-0.5 text-[11px] text-muted">
                            {pr.repo} #{pr.number}
                            {pr.isDraft && " · draft"}
                            {pr.prCreatedAt && ` · opened ${prAge(pr.prCreatedAt)} ago`}
                          </p>
                          {(pr.flags.length > 0 || pr.unknownMergeState) && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              {pr.flags.map((f) => (
                                <FlagBadge key={f} flag={f} />
                              ))}
                              {pr.unknownMergeState && (
                                <span
                                  title="GitHub computes merge state lazily; refresh again shortly."
                                  className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted"
                                >
                                  <QuestionIcon size={12} />
                                  Merge state unknown
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
