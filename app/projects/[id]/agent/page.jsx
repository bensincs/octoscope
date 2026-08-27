"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProjectContext } from "@/components/ProjectContext";
import AgentChat from "@/components/AgentChat";

// The Agent tab only exists once a project admin enables it.
export default function ProjectAgentPage() {
  const router = useRouter();
  const { project, projectId } = useProjectContext();

  useEffect(() => {
    if (project && !project.agentEnabled) {
      router.replace(`/projects/${projectId}/rulebook`);
    }
  }, [project, projectId, router]);

  if (!project || !project.agentEnabled) return null;

  return <AgentChat projectId={projectId} project={project} />;
}
