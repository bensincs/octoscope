"use client";
import { useState } from "react";
import {
  ShieldLockIcon,
  AlertIcon,
  ClockIcon,
  KeyIcon,
} from "@primer/octicons-react";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import { RETENTION_OPTIONS, describeRetention } from "@/lib/retention";
import { Panel } from "./primitives";

// Security and data-handling controls for a project.
//
// Structured as a list of independent controls so further settings can be added
// alongside without reshaping the panel.
function Control({ icon, title, children, action }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-3 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-1 gap-2.5">
        <span className="mt-0.5 shrink-0 text-muted">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">{title}</p>
          <div className="mt-0.5 space-y-1.5 text-xs text-muted">{children}</div>
        </div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

export default function SecurityPanel({ project, patch, canAdmin }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  const localOnly = !!project.localOnlyGithubData;
  const viewerToken = !!project.useViewerToken;

  async function toggleViewerToken(next) {
    if (next) {
      const ok = await confirm({
        title: "Use each member's GitHub sign-in?",
        body: "Stored access tokens for this project's repositories and boards will be deleted, and each member will fetch using their own GitHub account. Cached data is removed and kept in each browser instead, because a shared cache would let members read data GitHub would refuse them. Switching back means re-entering the tokens.",
        confirmLabel: "Switch to member sign-in",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await patch({ useViewerToken: next });
      toast.success(
        next
          ? "Stored tokens deleted — members now use their own GitHub sign-in."
          : "Members will use stored tokens again. Add one to each repository."
      );
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  const retention = project.retentionDays ?? null;

  async function setRetention(value) {
    setBusy(true);
    try {
      await patch({ retentionDays: value === "none" ? null : Number(value) });
      toast.success("Retention updated.");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleLocalOnly(next) {
    if (next) {
      const ok = await confirm({
        title: "Keep GitHub data out of the database?",
        body: "Everything currently cached for this project — issues, pull requests and decision records — will be deleted immediately. Members will need to refresh each tab to repopulate it in their own browser.",
        confirmLabel: "Enable and delete cached data",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await patch({ localOnlyGithubData: next });
      toast.success(
        next
          ? "GitHub data will no longer be stored, and cached data was deleted."
          : "GitHub data will be cached in the database again."
      );
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Security"
      blurb="Controls over how this project handles data."
    >
      <div className="rounded-md border border-border">
        <Control
          icon={<ShieldLockIcon size={16} />}
          title="Keep GitHub data out of the database"
          action={
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={localOnly}
                disabled={!canAdmin || busy || viewerToken}
                onChange={(e) => toggleLocalOnly(e.target.checked)}
              />
              <span className="text-fg">{localOnly ? "On" : "Off"}</span>
            </label>
          }
        >
          <p>
            Issues, pull requests and decision records are returned straight to
            each member&apos;s browser and held there (IndexedDB) instead of
            being cached in our database. Turning this on deletes anything
            already cached for this project.
          </p>
          <p className="flex items-start gap-1.5 text-attention">
            <span className="mt-0.5 shrink-0">
              <AlertIcon size={12} />
            </span>
            <span>
              Our server still <strong>fetches</strong> from GitHub, because the
              access tokens live server-side and sending them to a browser would
              be worse. The guarantee is that nothing fetched is written to our
              database — not that it never reaches our servers.
            </span>
          </p>
          {localOnly && (
            <p>
              Each member now maintains their own copy, so refreshing costs
              GitHub API quota per person rather than once for everyone.
            </p>
          )}
          {viewerToken && (
            <p>Required while members use their own GitHub sign-in.</p>
          )}
        </Control>
        <Control
          icon={<KeyIcon size={16} />}
          title="Use each member's GitHub sign-in instead of stored tokens"
          action={
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={viewerToken}
                disabled={!canAdmin || busy}
                onChange={(e) => toggleViewerToken(e.target.checked)}
              />
              <span className="text-fg">{viewerToken ? "On" : "Off"}</span>
            </label>
          }
        >
          <p>
            No access tokens are stored for this project. Each member fetches
            with their own GitHub account, so they see exactly what GitHub
            grants them — and a member who loses access to a repository loses it
            here at the same moment.
          </p>
          <p className="flex items-start gap-1.5 text-attention">
            <span className="mt-0.5 shrink-0">
              <AlertIcon size={12} />
            </span>
            <span>
              Turning this on <strong>deletes</strong> the stored tokens and
              forces data to stay in each browser. A shared cache filled by one
              member&apos;s token would be readable by members GitHub would have
              refused, so the two go together rather than being separate
              choices.
            </span>
          </p>
          {viewerToken && (
            <p>
              A repository a member cannot see reports an error for them alone;
              the rest still loads.
            </p>
          )}
        </Control>

        <Control
          icon={<ClockIcon size={16} />}
          title="Delete cached GitHub data after a period"
          action={
            <select
              className="gh-input px-2.5 py-1.5 text-sm disabled:opacity-50"
              value={retention ?? "none"}
              disabled={!canAdmin || busy || localOnly}
              onChange={(e) => setRetention(e.target.value)}
            >
              {RETENTION_OPTIONS.map((o) => (
                <option key={o.label} value={o.days ?? "none"}>
                  {o.label}
                </option>
              ))}
            </select>
          }
        >
          <p>
            Issues, pull requests and decision records are{" "}
            {describeRetention(retention)}. Expired data stops being shown
            immediately and is deleted by a nightly sweep, so the policy is
            enforced rather than only displayed.
          </p>
          {localOnly && (
            <p>
              Not applicable while GitHub data is kept out of the database —
              nothing is stored for this to apply to.
            </p>
          )}
        </Control>
      </div>

      {!canAdmin && (
        <p className="mt-3 text-xs text-muted">
          Only project admins can change these settings.
        </p>
      )}
    </Panel>
  );
}
