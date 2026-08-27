"use client";
import { useEffect, useRef } from "react";
import { XIcon } from "@primer/octicons-react";

// Lightweight centered modal dialog. Closes on Escape, backdrop click, or the
// close button. Body scroll is locked while open. Focus is trapped inside and
// restored to the previously focused element on close.
export default function Modal({ open, onClose, title, children }) {
  const dialogRef = useRef(null);
  const restoreRef = useRef(null);

  // Callers pass an inline `onClose={() => setOpen(false)}`, so its identity
  // changes on every render of the component that owns the modal. Keeping it in
  // a ref lets the effect below depend on `open` alone.
  //
  // This matters: if `onClose` were a dependency, any parent re-render would
  // tear down and re-run the effect, which re-focuses the first focusable
  // element. For a modal whose input state lives in the parent, that means
  // focus jumps out of the field on every keystroke.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    restoreRef.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus on open. The close button sits before `children` in the DOM, so
    // the first focusable is always the X — fine for a confirmation, wrong for
    // a form. A caller can mark the field it wants with `data-autofocus`.
    // (React's `autoFocus` prop is unreliable here: the effect below would run
    // afterwards and steal focus back.)
    const preferred = dialogRef.current?.querySelector("[data-autofocus]");
    const focusables = getFocusable(dialogRef.current);
    (preferred ?? focusables[0] ?? dialogRef.current)?.focus();

    function onKey(e) {
      if (e.key === "Escape") {
        onCloseRef.current?.();
        return;
      }
      if (e.key === "Tab") trapTab(e, dialogRef.current);
    }
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      // Restore focus to whatever opened the modal.
      if (restoreRef.current instanceof HTMLElement) restoreRef.current.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-[10vh]"
      onMouseDown={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="gh-card animate-fadeup w-full max-w-md p-5 shadow-xl outline-none"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted hover:text-fg"
            aria-label="Close"
          >
            <XIcon size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function getFocusable(root) {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

function trapTab(e, root) {
  const items = getFocusable(root);
  if (items.length === 0) {
    e.preventDefault();
    root?.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === root)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}
