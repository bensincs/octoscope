"use client";
// Platform settings, reached from the "Settings" tab next to "Projects".
//
// Super-admin only. The agent's model connection is configured per PROJECT
// rather than per user, so there is no account-level configuration to show
// anyone else. Guarded client-side here; /api/admin/* enforces access
// server-side regardless.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldLockIcon } from "@primer/octicons-react";
import { useNav } from "@/components/NavContext";
import { useSuperAdmin } from "@/components/SuperAdminContext";
import { Spinner } from "@/components/projectForms";
import { NavButton } from "@/components/settings/primitives";
import SuperAdminsPanel from "@/components/settings/SuperAdminsPanel";

export default function SettingsPage() {
  const router = useRouter();
  const { superAdmin, loading } = useSuperAdmin();
  const { setBreadcrumb, setTabs } = useNav();
  const [section, setSection] = useState("super-admins");

  const nav = [
    {
      heading: "Platform",
      items: [
        { key: "super-admins", label: "Super admins", icon: <ShieldLockIcon size={16} /> },
      ],
    },
  ];

  useEffect(() => {
    setBreadcrumb([]);
    setTabs([
      { label: "Projects", onClick: () => router.push("/") },
      { label: "Settings", active: true },
    ]);
    return () => setTabs([]);
  }, [router, setBreadcrumb, setTabs]);

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex items-center justify-center py-24 text-muted">
          <Spinner className="h-5 w-5" />
        </div>
      </main>
    );
  }

  if (!superAdmin) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          You don&apos;t have access to this page.
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="md:sticky md:top-4 md:self-start">
          {nav.map((group) => (
            <div key={group.heading} className="mb-4">
              <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {group.heading}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((s) => (
                  <li key={s.key}>
                    <NavButton
                      active={section === s.key}
                      icon={s.icon}
                      onClick={() => setSection(s.key)}
                    >
                      {s.label}
                    </NavButton>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="min-w-0">
          {section === "super-admins" && <SuperAdminsPanel />}
        </div>
      </div>
    </main>
  );
}
