"use client";
// GitHub-style settings surface for an existing audit project. A grouped left
// section nav drives the visible panel:
//   General      → General, Rulebook
//   Connections  → Repositories, Boards
//   Collaborators→ Members (user access control)
//   (Danger zone, owner-only, sits on its own at the bottom)
// What a member can change depends on their role (viewer/editor/admin/owner).
import { useEffect, useState } from "react";
import {
  GearIcon,
  BookIcon,
  RepoIcon,
  ProjectIcon,
  PeopleIcon,
  AlertIcon,
} from "@primer/octicons-react";
import { useOwners } from "@/components/projectForms";
import { NavButton, RoleBadge } from "./settings/primitives";
import GeneralPanel from "./settings/GeneralPanel";
import RulebookPanel from "./settings/RulebookPanel";
import ReposPanel from "./settings/ReposPanel";
import BoardsPanel from "./settings/BoardsPanel";
import CollaboratorsPanel from "./settings/CollaboratorsPanel";
import DangerPanel from "./settings/DangerPanel";

const NAV = [
  {
    heading: "General",
    items: [
      { key: "general", label: "General", icon: <GearIcon size={16} /> },
      { key: "rulebook", label: "Rulebook", icon: <BookIcon size={16} /> },
    ],
  },
  {
    heading: "Connections",
    items: [
      { key: "repos", label: "Repositories", icon: <RepoIcon size={16} /> },
      { key: "boards", label: "Boards", icon: <ProjectIcon size={16} /> },
    ],
  },
  {
    heading: "Collaborators",
    items: [{ key: "collaborators", label: "Members", icon: <PeopleIcon size={16} /> }],
  },
];

const ROLE_RANK = { viewer: 1, editor: 2, admin: 3, owner: 4 };

export default function ProjectSettings({
  project,
  reload,
  onChanged,
  onBackToAudit,
  onDeleted,
}) {
  const [section, setSection] = useState("general");

  // Local working copies so add/remove feels instant; seeded from the loaded
  // project and re-seeded whenever it changes (e.g. after a reload()).
  const [repos, setRepos] = useState(project.repos ?? []);
  const [boards, setBoards] = useState(project.boards ?? []);
  useEffect(() => setRepos(project.repos ?? []), [project.repos]);
  useEffect(() => setBoards(project.boards ?? []), [project.boards]);

  const owners = useOwners();

  // The caller's role on this project gates what they can change.
  const role = project.viewerRole || "owner";
  const canEdit = ROLE_RANK[role] >= ROLE_RANK.editor;
  const canAdmin = ROLE_RANK[role] >= ROLE_RANK.admin;
  const isOwner = role === "owner";

  // Persist a partial patch ({name} or {config}) and refresh the parent.
  async function patch(body) {
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(
        data.fields?.[0]?.message || data.error || "Failed to save"
      );
      err.fields = data.fields;
      throw err;
    }
    await reload?.();
    onChanged?.();
    return data;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <RoleBadge role={role} />
      </div>

      <div className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="md:sticky md:top-4 md:self-start">
          {NAV.map((group) => (
            <div key={group.heading} className="mb-4">
              <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {group.heading}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((s) => (
                  <li key={s.key}>
                    <NavButton
                      active={section === s.key}
                      icon={s.icon}
                      onClick={() => setSection(s.key)}
                    >
                      {s.label}
                    </NavButton>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {isOwner && (
            <div className="mb-4">
              <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Advanced
              </p>
              <ul className="space-y-0.5">
                <li>
                  <NavButton
                    active={section === "danger"}
                    danger
                    icon={<AlertIcon size={16} />}
                    onClick={() => setSection("danger")}
                  >
                    Danger zone
                  </NavButton>
                </li>
              </ul>
            </div>
          )}
        </nav>

        <div className="min-w-0">
          {!canEdit && section !== "collaborators" && (
            <div className="mb-3 rounded-md border border-border bg-subtle px-3 py-2 text-xs text-muted">
              You have <span className="font-semibold text-fg">{role}</span> access — these
              settings are read-only.
            </div>
          )}
          {section === "general" && (
            <GeneralPanel project={project} patch={patch} canEdit={canEdit} />
          )}
          {section === "rulebook" && (
            <RulebookPanel project={project} patch={patch} canEdit={canEdit} />
          )}
          {section === "repos" && (
            <ReposPanel
              project={project}
              owners={owners}
              repos={repos}
              setRepos={setRepos}
              onChanged={onChanged}
              canEdit={canEdit}
            />
          )}
          {section === "boards" && (
            <BoardsPanel
              project={project}
              owners={owners}
              boards={boards}
              setBoards={setBoards}
              onChanged={onChanged}
              canEdit={canEdit}
            />
          )}
          {section === "collaborators" && (
            <CollaboratorsPanel project={project} canAdmin={canAdmin} />
          )}
          {section === "danger" && isOwner && (
            <DangerPanel project={project} onDeleted={onDeleted} />
          )}
        </div>
      </div>
    </div>
  );
}
