"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProjectContext } from "@/components/ProjectContext";
import EnvironmentsBoard from "@/components/EnvironmentsBoard";

// Mirrors the Welcome route: the tab only exists while environments are
// configured, so an empty list here means they were all just removed.
export default function ProjectEnvironmentsPage() {
  const router = useRouter();
  const { project, reload, projectId } = useProjectContext();
  const environments = project?.environments ?? [];

  useEffect(() => {
    if (project && environments.length === 0) {
      router.replace(`/projects/${projectId}/rulebook`);
    }
  }, [project, environments.length, projectId, router]);

  if (!project || environments.length === 0) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-normal text-fg">Environments</h1>
        <p className="mt-1 text-sm text-muted">
          Claim an environment to tell the rest of the project you're using it.
          Release it when you're done.
        </p>
      </div>
      <EnvironmentsBoard
        project={project}
        environments={environments}
        reload={reload}
      />
    </div>
  );
}
