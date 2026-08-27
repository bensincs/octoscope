"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProjectContext } from "@/components/ProjectContext";
import IssuesBoard from "@/components/IssuesBoard";

// The Issues tab only exists once a repository is connected — there is nothing
// to scan otherwise. Mirrors Welcome, Pull requests and Environments.
export default function ProjectIssuesPage() {
  const router = useRouter();
  const { project, projectId } = useProjectContext();
  const repoCount = project?.repos?.length ?? 0;

  useEffect(() => {
    if (project && repoCount === 0) {
      router.replace(`/projects/${projectId}/rulebook`);
    }
  }, [project, repoCount, projectId, router]);

  if (!project || repoCount === 0) return null;

  return (
    <IssuesBoard projectId={projectId} project={project} />
  );
}
