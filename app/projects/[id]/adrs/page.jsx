"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProjectContext } from "@/components/ProjectContext";
import AdrBoard from "@/components/AdrBoard";

// The ADR tab only exists once a source repo AND folder are configured, so
// reaching this route without them means they were just cleared.
export default function ProjectAdrPage() {
  const router = useRouter();
  const { project, projectId } = useProjectContext();
  const configured = !!project?.adrRepoId && !!project?.adrPath;

  useEffect(() => {
    if (project && !configured) {
      router.replace(`/projects/${projectId}/rulebook`);
    }
  }, [project, configured, projectId, router]);

  if (!project || !configured) return null;

  return <AdrBoard projectId={projectId} />;
}
