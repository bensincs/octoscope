"use client";
// Shared presentational primitives for the project settings panels.
import { XIcon } from "@primer/octicons-react";
import { ReplacePat } from "@/components/projectForms";

// Section wrapper: GitHub-style heading + underline rule, optional right-side
// action (e.g. an "Add" button) and a descriptive blurb.
export function Panel({ title, blurb, action, children }) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
        <h2 className="text-xl font-normal text-fg">{title}</h2>
        {action}
      </div>
      {blurb && <p className="mt-3 text-sm text-muted">{blurb}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function NavButton({ active, danger, icon, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors " +
        (active
          ? "bg-subtle font-semibold text-fg"
          : danger
          ? "text-danger hover:bg-danger/10"
          : "text-muted hover:bg-subtle hover:text-fg")
      }
    >
      {icon && (
        <span className="grid h-4 w-4 shrink-0 place-items-center leading-none">
          {icon}
        </span>
      )}
      <span>{children}</span>
    </button>
  );
}

export function RoleBadge({ role }) {
  return (
    <span className="rounded-full border border-border bg-subtle px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
      {role}
    </span>
  );
}

// A bordered list box with divided rows (GitHub "Box" pattern). When there are
// no children it shows a centered empty message instead.
export function ListBox({ children, empty }) {
  const hasItems = Array.isArray(children)
    ? children.some(Boolean)
    : Boolean(children);
  if (!hasItems) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted">
        {empty}
      </div>
    );
  }
  return (
    <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
      {children}
    </div>
  );
}

// A single borderless row for use inside a ListBox. Shows a primary label,
// optional secondary text, a "PAT" pill, and (when editable) replace/remove
// controls on the right.
export function ResourceRow({
  primary,
  secondary,
  endpoint,
  hasPat,
  onRemove,
  removeLabel,
  canEdit,
  children,
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-sm">
      <div className="min-w-0">
        <span className="truncate text-fg">{primary}</span>
        {secondary && (
          <span className="ml-1.5 text-[11px] text-muted">{secondary}</span>
        )}
      </div>
      {hasPat !== false && (
        <span className="rounded-full border border-success/40 bg-success/10 px-1.5 text-[10px] text-success">
          PAT
        </span>
      )}
      {(canEdit || children) && (
        <div className="ml-auto flex items-center gap-1">
          {children}
          {canEdit && endpoint && <ReplacePat endpoint={endpoint} />}
          {canEdit && onRemove && (
            <button
              onClick={onRemove}
              className="rounded p-1 text-muted hover:text-danger"
              aria-label={removeLabel}
            >
              <XIcon size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
