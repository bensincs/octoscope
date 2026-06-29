"use client";
import { useRouter } from "next/navigation";
import { useProjectContext } from "@/components/ProjectContext";
import AuditRunner from "@/components/AuditRunner";

export default function ProjectAuditPage() {
  const router = useRouter();
  const { project, projectId } = useProjectContext();

  return (
    <AuditRunner
      projectId={projectId}
      project={project}
      onEditSettings={() => router.push(`/projects/${projectId}/settings`)}
    />
  );
}
