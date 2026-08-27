"use client";
// User settings, reached from the "Settings" tab next to "Projects".
//
// Available to every signed-in user, not just super admins: it holds per-user
// configuration such as the Copilot connection that powers the Agent tab. The
// Platform section is added only for super admins — and the /api/admin/* routes
// enforce that server-side regardless, so this is presentation, not security.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldLockIcon, CopilotIcon } from "@primer/octicons-react";
import { useNav } from "@/components/NavContext";
import { useSuperAdmin } from "@/components/SuperAdminContext";
import { Spinner } from "@/components/projectForms";
import { NavButton } from "@/components/settings/primitives";
import SuperAdminsPanel from "@/components/settings/SuperAdminsPanel";
import CopilotPanel from "@/components/settings/CopilotPanel";

export default function SettingsPage() {
  const router = useRouter();
  const { superAdmin, loading } = useSuperAdmin();
  const { setBreadcrumb, setTabs } = useNav();
  const [section, setSection] = useState("copilot");

  const nav = useMemo(() => {
    const groups = [
      {
        heading: "Your account",
        items: [
          { key: "copilot", label: "GitHub Copilot", icon: <CopilotIcon size={16} /> },
        ],
      },
    ];
    if (superAdmin) {
      groups.push({
        heading: "Platform",
        items: [
          {
            key: "super-admins",
            label: "Super admins",
            icon: <ShieldLockIcon size={16} />,
          },
        ],
      });
    }
    return groups;
  }, [superAdmin]);

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
          {section === "copilot" && <CopilotPanel />}
          {section === "super-admins" && superAdmin && <SuperAdminsPanel />}
        </div>
      </div>
    </main>
  );
}
