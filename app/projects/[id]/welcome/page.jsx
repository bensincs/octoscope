"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProjectContext } from "@/components/ProjectContext";
import Markdown from "@/components/Markdown";

// The Welcome tab only exists while a welcome page is set, so reaching this
// route with an empty one means it was just cleared (or somebody deep-linked).
// Bounce to the audit rather than rendering a blank page.
export default function ProjectWelcomePage() {
  const router = useRouter();
  const { project, projectId } = useProjectContext();
  const body = project?.welcomeMarkdown?.trim();

  useEffect(() => {
    if (project && !body) router.replace(`/projects/${projectId}/rulebook`);
  }, [project, body, projectId, router]);

  if (!body) return null;

  return (
    <article className="gh-card max-w-3xl px-5 py-4">
      <Markdown>{body}</Markdown>
    </article>
  );
}
