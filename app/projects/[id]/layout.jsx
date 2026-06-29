"use client";
import { use, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ProjectProvider } from "@/components/ProjectContext";
import { useNav } from "@/components/NavContext";
import { Spinner } from "@/components/projectForms";

// Loads the project once for both the audit and settings routes, publishes the
// breadcrumb + sub-nav tabs, and shares the project via context.
export default function ProjectLayout({ children, params }) {
  const { id } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const { setBreadcrumb, setTabs } = useNav();

  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load project");
      setProject(data);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const onSettings = pathname.endsWith("/settings");

  useEffect(() => {
    const crumbs = [{ label: "Projects", onClick: () => router.push("/") }];
    if (project) {
      crumbs.push({
        label: project.name,
        onClick: onSettings ? () => router.push(`/projects/${id}`) : undefined,
      });
      if (onSettings) crumbs.push({ label: "Settings" });
    }
    setBreadcrumb(crumbs);
    setTabs([
      { label: "Audit", active: !onSettings, onClick: () => router.push(`/projects/${id}`) },
      {
        label: "Settings",
        active: onSettings,
        onClick: () => router.push(`/projects/${id}/settings`),
      },
    ]);
    return () => {
      setBreadcrumb([]);
      setTabs([]);
    };
  }, [project, onSettings, id, router, setBreadcrumb, setTabs]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      {loading && !project ? (
        <div className="flex items-center justify-center py-24 text-muted">
          <Spinner className="h-5 w-5" />
        </div>
      ) : error && !project ? (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : (
        <ProjectProvider value={{ project, reload, projectId: id }}>
          {children}
        </ProjectProvider>
      )}
    </main>
  );
}
