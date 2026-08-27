"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { ServerIcon } from "@primer/octicons-react";
import { meetsRole } from "@/lib/access";
import {
  CLAIM_DURATIONS,
  DEFAULT_CLAIM_HOURS,
  describeRemaining,
} from "@/lib/environments";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import Modal from "@/components/Modal";
import { Spinner } from "@/components/projectForms";

// Coarse relative time — environments get claimed for hours or days, so
// minute-level precision past an hour is noise.
function timeAgo(iso) {
  if (!iso) return "";
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export default function EnvironmentsBoard({ project, environments, reload }) {
  const { data: session } = useSession();
  const toast = useToast();
  const confirm = useConfirm();

  const [claiming, setClaiming] = useState(null); // environment being claimed
  const [note, setNote] = useState("");
  const [hours, setHours] = useState(DEFAULT_CLAIM_HOURS);
  const [busyId, setBusyId] = useState(null);

  const myUserId = session?.user?.id;
  const role = project.viewerRole || "owner";
  const canForceRelease = meetsRole(role, "admin");

  async function send(env, method, body) {
    setBusyId(env.id);
    try {
      const res = await fetch(
        `/api/projects/${project.id}/environments/${env.id}/claim`,
        {
          method,
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.fields?.[0]?.message || data.error || "Request failed");
      }
      await reload?.();
      return data;
    } finally {
      setBusyId(null);
    }
  }

  async function claim() {
    const env = claiming;
    try {
      await send(env, "POST", {
        note: note.trim(),
        expiresInHours: hours === "none" ? null : Number(hours),
      });
      toast.success(`Claimed ${env.name}.`);
      setClaiming(null);
      setNote("");
    } catch (e) {
      // Losing a race is expected, not exceptional — reload so the board shows
      // who actually holds it.
      toast.error(e.message);
      await reload?.();
      setClaiming(null);
      setNote("");
    }
  }

  async function extend(env) {
    try {
      await send(env, "POST", {
        note: env.claim?.note ?? "",
        expiresInHours: DEFAULT_CLAIM_HOURS,
      });
      toast.success(`Extended ${env.name}.`);
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function release(env) {
    const mine = env.claim?.userId === myUserId;
    if (!mine) {
      const ok = await confirm({
        title: "Release someone else's claim?",
        body: `“${env.name}” is claimed by ${env.claim?.login}. Releasing it may interrupt what they're doing.`,
        confirmLabel: "Release anyway",
      });
      if (!ok) return;
    }
    try {
      await send(env, "DELETE");
      toast.success(`Released ${env.name}.`);
    } catch (e) {
      toast.error(e.message);
    }
  }

  if (!environments.length) {
    return (
      <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
        No environments configured yet.
      </div>
    );
  }

  return (
    <>
      <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {environments.map((env) => {
          const claim = env.claim;
          const mine = claim?.userId === myUserId;
          const busy = busyId === env.id;

          return (
            <div
              key={env.id}
              className="gh-card flex h-full flex-col gap-3 px-4 py-3"
              data-claimed={claim ? "true" : "false"}
            >
              <div className="flex items-start gap-2">
                <span className={claim ? "mt-0.5 text-muted" : "mt-0.5 text-success"}>
                  <ServerIcon size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">{env.name}</p>
                  {env.description && (
                    <p className="mt-0.5 text-xs leading-5 text-muted">
                      {env.description}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex-1 text-xs">
                {claim ? (
                  <div className="flex items-start gap-2">
                    {claim.avatarUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={claim.avatarUrl}
                        alt=""
                        className="mt-0.5 h-5 w-5 shrink-0 rounded-full"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="text-fg">
                        <span className="font-semibold">
                          {mine ? "You" : claim.name || claim.login}
                        </span>{" "}
                        <span className="text-muted">
                          claimed this {timeAgo(claim.claimedAt)}
                        </span>
                      </p>
                      <p className="mt-0.5 text-muted">
                        {claim.expiresAt ? (
                          <span
                            className={
                              new Date(claim.expiresAt).getTime() - Date.now() <
                              3_600_000
                                ? "text-attention"
                                : undefined
                            }
                          >
                            {describeRemaining(claim.expiresAt)}
                          </span>
                        ) : (
                          "No expiry"
                        )}
                      </p>
                      {claim.note && (
                        <p className="mt-0.5 break-words text-muted">“{claim.note}”</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-muted">Available</p>
                )}
              </div>

              <div className="mt-auto flex items-center gap-2 border-t border-border pt-2">
                {busy ? (
                  <Spinner className="h-4 w-4" />
                ) : !claim ? (
                  <button
                    onClick={() => {
                      setClaiming(env);
                      setNote("");
                      setHours(DEFAULT_CLAIM_HOURS);
                    }}
                    className="btn-primary px-2.5 py-1 text-xs"
                  >
                    Claim
                  </button>
                ) : mine || canForceRelease ? (
                  <>
                    <button
                      onClick={() => release(env)}
                      className="btn px-2.5 py-1 text-xs"
                    >
                      {mine ? "Release" : "Force release"}
                    </button>
                    {mine && claim.expiresAt && (
                      <button
                        onClick={() => extend(env)}
                        className="btn px-2.5 py-1 text-xs"
                      >
                        Extend
                      </button>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-muted">
                    Only {claim.login} or an admin can release this.
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        open={!!claiming}
        onClose={() => setClaiming(null)}
        title={`Claim ${claiming?.name ?? ""}`}
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Let other members know what you're using it for. Optional.
          </p>
          <input
            data-autofocus
            className="gh-input w-full px-2.5 py-1.5 text-sm"
            placeholder="e.g. testing the release candidate"
            maxLength={280}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && claim()}
          />

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-muted">
              Hold for
            </label>
            <select
              className="gh-input w-full px-2.5 py-1.5 text-sm"
              value={hours ?? "none"}
              onChange={(e) => setHours(e.target.value)}
            >
              {CLAIM_DURATIONS.map((d) => (
                <option key={d.label} value={d.hours ?? "none"}>
                  {d.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted">
              The environment frees itself when this elapses. You can extend or
              release it at any time.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setClaiming(null)}
              className="btn px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button onClick={claim} className="btn-primary px-3 py-1.5 text-sm">
              Claim
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
