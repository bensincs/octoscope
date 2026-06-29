"use client";
import { useState } from "react";
import Modal from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import { AddRepoForm } from "@/components/projectForms";
import { Panel, ListBox, ResourceRow } from "./primitives";

export default function ReposPanel({
  project,
  owners,
  repos,
  setRepos,
  onChanged,
  canEdit,
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);

  async function remove(repo) {
    const ok = await confirm({
      title: "Remove repository?",
      body: `“${repo.nameWithOwner}” and its stored PAT will be removed from this project.`,
      confirmLabel: "Remove repository",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/projects/${project.id}/repos/${repo.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to remove repository");
      }
      setRepos((list) => list.filter((x) => x.id !== repo.id));
      onChanged?.();
      toast.success(`Removed ${repo.nameWithOwner}.`);
    } catch (e) {
      toast.error(e.message);
    }
  }

  return (
    <Panel
      title="Repositories"
      blurb="Each repository carries its own read-only PAT used to fetch issues."
      action={
        canEdit && (
          <button
            onClick={() => setAdding(true)}
            className="btn-primary shrink-0 px-3 py-1.5 text-sm"
          >
            Add repository
          </button>
        )
      }
    >
      <ListBox empty="No repositories yet. Add at least one to run audits.">
        {repos.map((r) => (
          <ResourceRow
            key={r.id}
            primary={r.nameWithOwner}
            endpoint={`/api/projects/${project.id}/repos/${r.id}`}
            hasPat={r.hasPat}
            onRemove={() => remove(r)}
            removeLabel="Remove repository"
            canEdit={canEdit}
          />
        ))}
      </ListBox>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a repository">
        <AddRepoForm
          projectId={project.id}
          owners={owners}
          onAdded={(repo) => {
            setRepos((list) => [...list, repo]);
            onChanged?.();
            setAdding(false);
            toast.success(`Added ${repo.nameWithOwner}.`);
          }}
        />
      </Modal>
    </Panel>
  );
}
