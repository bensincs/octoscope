"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProjectContext } from "@/components/ProjectContext";
import PullRequestsBoard from "@/components/PullRequestsBoard";

// Like Welcome and Environments, the tab only exists when it has a source of
// data — here, at least one connected repository.
export default function ProjectPullRequestsPage() {
  const router = useRouter();
  const { project, projectId } = useProjectContext();
  const repoCount = project?.repos?.length ?? 0;

  useEffect(() => {
    if (project && repoCount === 0) {
      router.replace(`/projects/${projectId}/rulebook`);
    }
  }, [project, repoCount, projectId, router]);

  if (!project || repoCount === 0) return null;

  return <PullRequestsBoard projectId={projectId} />;
}
