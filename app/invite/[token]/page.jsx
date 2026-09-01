"use client";
import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { PersonAddIcon, AlertIcon } from "@primer/octicons-react";
import { Spinner } from "@/components/projectForms";

// Landing page for an invite link.
//
// The preview is fetched WITHOUT signing in, so someone following a link can
// see what they are being invited to before handing over an identity. Redeeming
// requires sign-in, because the membership has to attach to an account.
export default function InvitePage({ params }) {
  const { token } = use(params);
  const router = useRouter();
  const { status } = useSession();
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(token)}`);
      setPreview(await res.json());
    } catch {
      setPreview({ valid: false, reason: "This invite link could not be checked." });
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(token)}/accept`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.fields?.[0]?.message || data.error || "Could not accept");
      }
      router.replace(`/projects/${data.projectId}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  if (!preview || status === "loading") {
    return (
      <main className="mx-auto flex max-w-md items-center justify-center px-4 py-24 text-muted">
        <Spinner className="h-5 w-5" />
      </main>
    );
  }

  if (!preview.valid) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <div className="gh-card px-5 py-5 text-center">
          <span className="text-attention">
            <AlertIcon size={24} />
          </span>
          <h1 className="mt-2 text-lg text-fg">{preview.reason}</h1>
          <p className="mt-1 text-sm text-muted">
            Ask whoever sent it for a new link.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <div className="gh-card px-5 py-5 text-center">
        <span className="text-accent">
          <PersonAddIcon size={24} />
        </span>
        <h1 className="mt-2 text-lg text-fg">
          You&apos;ve been invited to {preview.projectName}
        </h1>
        <p className="mt-1 text-sm text-muted">
          You&apos;ll join as{" "}
          <span className="font-semibold text-fg">{preview.role}</span>. This
          link works once.
        </p>

        {error && (
          <p className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        <div className="mt-4">
          {status === "authenticated" ? (
            <button
              onClick={accept}
              disabled={busy}
              className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
            >
              {busy ? "Joining…" : "Accept invite"}
            </button>
          ) : (
            <button
              onClick={() => signIn("github", { callbackUrl: window.location.href })}
              className="btn-primary px-4 py-2 text-sm"
            >
              Sign in with GitHub to accept
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
