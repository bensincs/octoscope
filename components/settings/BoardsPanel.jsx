"use client";
import { useState } from "react";
import Modal from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import { AddBoardForm } from "@/components/projectForms";
import { Panel, ListBox, ResourceRow } from "./primitives";

export default function BoardsPanel({
  project,
  owners,
  boards,
  setBoards,
  onChanged,
  canEdit,
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);

  function label(b) {
    return b.title || `${b.ownerLogin} #${b.projectNumber}`;
  }

  async function remove(board) {
    const ok = await confirm({
      title: "Remove board?",
      body: `“${label(board)}” and its stored PAT will be removed from this project.`,
      confirmLabel: "Remove board",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/projects/${project.id}/boards/${board.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to remove board");
      }
      setBoards((list) => list.filter((x) => x.id !== board.id));
      onChanged?.();
      toast.success(`Removed ${label(board)}.`);
    } catch (e) {
      toast.error(e.message);
    }
  }

  return (
    <Panel
      title="Boards"
      blurb="Optional Projects v2 boards unlock sprint, status and membership rules."
      action={
        canEdit && (
          <button
            onClick={() => setAdding(true)}
            className="btn-primary shrink-0 px-3 py-1.5 text-sm"
          >
            Add board
          </button>
        )
      }
    >
      <ListBox empty="No boards linked. These are optional.">
        {boards.map((b) => (
          <ResourceRow
            key={b.id}
            primary={label(b)}
            secondary={`${b.ownerLogin} #${b.projectNumber}`}
            endpoint={`/api/projects/${project.id}/boards/${b.id}`}
            hasPat={b.hasPat}
            onRemove={() => remove(b)}
            removeLabel="Remove board"
            canEdit={canEdit}
          />
        ))}
      </ListBox>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a board">
        <AddBoardForm
          projectId={project.id}
          owners={owners}
          onAdded={(board) => {
            setBoards((list) => [...list, board]);
            onChanged?.();
            setAdding(false);
            toast.success(`Added ${label(board)}.`);
          }}
        />
      </Modal>
    </Panel>
  );
}
