"use client";
import { use, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ProjectProvider } from "@/components/ProjectContext";
import { useNav } from "@/components/NavContext";
import { Spinner } from "@/components/projectForms";

// Loads the project once for every child route, publishes the breadcrumb +
// sub-nav tabs, and shares the project via context.
//
// Two tabs are conditional and are hidden entirely rather than disabled:
//   Welcome       — only once an admin has written a welcome page
//   Issues        — only once at least one repository is connected
//   Pull requests — only once at least one repository is connected
//   Decisions     — only once an ADR repo + folder are configured
//   Agent         — only once a project admin enables it
//   Environments  — only once at least one environment is configured
//
// Rulebook is always present: it describes configuration, which exists whether
// or not anything has been connected or scanned.
// A project with neither looks exactly as it did before the feature existed.
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

  // "/projects/:id/issues" -> "issues"; the bare "/projects/:id" -> "" (it only
  // ever redirects, so it never needs to match a tab).
  const section = pathname.split("/")[3] ?? "";

  const hasWelcome = !!project?.welcomeMarkdown?.trim();
  const hasEnvironments = (project?.environments?.length ?? 0) > 0;
  const hasRepos = (project?.repos?.length ?? 0) > 0;
  const hasAdrs = !!project?.adrRepoId && !!project?.adrPath;
  const hasAgent = !!project?.agentEnabled;

  useEffect(() => {
    const go = (path) => () => router.push(`/projects/${id}${path}`);

    const crumbs = [{ label: "Projects", onClick: () => router.push("/") }];
    if (project) {
      crumbs.push({
        label: project.name,
        onClick: section ? go("") : undefined,
      });
      const crumbLabel = {
        welcome: "Welcome",
        issues: "Issues",
        rulebook: "Rulebook",
        "pull-requests": "Pull requests",
        adrs: "Decisions",
        agent: "Agent",
        environments: "Environments",
        settings: "Settings",
      }[section];
      if (crumbLabel) crumbs.push({ label: crumbLabel });
    }
    setBreadcrumb(crumbs);

    setTabs([
      ...(hasWelcome
        ? [
            {
              label: "Welcome",
              active: section === "welcome",
              onClick: go("/welcome"),
            },
          ]
        : []),
      ...(hasRepos
        ? [
            {
              label: "Issues",
              active: section === "issues",
              onClick: go("/issues"),
            },
          ]
        : []),
      {
        label: "Rulebook",
        active: section === "rulebook",
        onClick: go("/rulebook"),
      },
      ...(hasRepos
        ? [
            {
              label: "Pull requests",
              active: section === "pull-requests",
              onClick: go("/pull-requests"),
            },
          ]
        : []),
      ...(hasAdrs
        ? [
            {
              label: "Decisions",
              active: section === "adrs",
              onClick: go("/adrs"),
            },
          ]
        : []),
      ...(hasAgent
        ? [
            {
              label: "Agent",
              active: section === "agent",
              onClick: go("/agent"),
            },
          ]
        : []),
      ...(hasEnvironments
        ? [
            {
              label: "Environments",
              active: section === "environments",
              onClick: go("/environments"),
            },
          ]
        : []),
      {
        label: "Settings",
        active: section === "settings",
        onClick: go("/settings"),
      },
    ]);

    return () => {
      setBreadcrumb([]);
      setTabs([]);
    };
  }, [
    project,
    section,
    hasWelcome,
    hasEnvironments,
    hasRepos,
    hasAdrs,
    id,
    router,
    setBreadcrumb,
    setTabs,
  ]);

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
