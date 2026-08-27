"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProjectContext } from "@/components/ProjectContext";
import { Spinner } from "@/components/projectForms";

// The bare /projects/:id URL doesn't render anything itself — it decides where
// you should land, cascading past tabs that aren't visible:
//   welcome (if written) -> issues (if a repo is connected) -> rulebook
// Rulebook is the floor because it's the only content tab always present.
//
// `replace` rather than `push` so the redirect doesn't sit in history and trap
// the back button between here and the destination.
export default function ProjectIndexPage() {
  const router = useRouter();
  const { project, projectId } = useProjectContext();

  useEffect(() => {
    if (!project) return;
    const target = project.welcomeMarkdown?.trim()
      ? "welcome"
      : project.repos?.length
        ? "issues"
        : "rulebook";
    router.replace(`/projects/${projectId}/${target}`);
  }, [project, projectId, router]);

  return (
    <div className="flex items-center justify-center py-24 text-muted">
      <Spinner className="h-5 w-5" />
    </div>
  );
}
