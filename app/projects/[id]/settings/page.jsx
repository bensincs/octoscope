"use client";
import { useRouter } from "next/navigation";
import { useProjectContext } from "@/components/ProjectContext";
import ProjectSettings from "@/components/ProjectSettings";

export default function ProjectSettingsPage() {
  const router = useRouter();
  const { project, reload, projectId } = useProjectContext();

  return (
    <ProjectSettings
      project={project}
      reload={reload}
      onChanged={reload}
      onBackToAudit={() => router.push(`/projects/${projectId}`)}
      onDeleted={() => router.push("/")}
    />
  );
}
