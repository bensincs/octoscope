"use client";
// Chip / token input. Type a value and press Enter (or comma) to commit it as a
// pill; Backspace on an empty field removes the last one. Used for issue-type
// names per hierarchy level and for the allowed-labels list.
import { useRef, useState } from "react";
import { XIcon } from "@primer/octicons-react";

export default function TagInput({
  tags = [],
  onChange,
  placeholder = "Type and press Enter…",
  ariaLabel,
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  function commit(raw) {
    const v = String(raw).trim();
    setDraft("");
    if (!v) return;
    // Case-insensitive de-dupe.
    if (tags.some((t) => t.toLowerCase() === v.toLowerCase())) return;
    onChange([...tags, v]);
  }

  function removeAt(i) {
    onChange(tags.filter((_, idx) => idx !== i));
  }

  function onKeyDown(e) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && draft === "" && tags.length) {
      e.preventDefault();
      removeAt(tags.length - 1);
    }
  }

  return (
    <div
      className="gh-input flex flex-wrap items-center gap-1.5 px-2 py-1.5"
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((t, i) => (
        <span
          key={`${t}-${i}`}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-subtle px-2 py-0.5 text-xs text-fg"
        >
          {t}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeAt(i);
            }}
            className="inline-flex text-muted hover:text-danger"
            aria-label={`Remove ${t}`}
          >
            <XIcon size={12} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="min-w-[10ch] flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
        placeholder={tags.length ? "" : placeholder}
        aria-label={ariaLabel}
      />
    </div>
  );
}
