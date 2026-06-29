"use client";
// Type-ahead combobox: a free-text input with a filtered suggestion dropdown.
// The field always accepts typed values (so manual entry works even when the
// browse list is empty), and matching suggestions can be picked with mouse or
// keyboard. Options: [{ value, label?, hint? }].
import { useEffect, useRef, useState } from "react";

export default function Combobox({
  value = "",
  onChange,
  onSelect,
  options = [],
  placeholder,
  loading = false,
  disabled = false,
  emptyText = "No matches",
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef(null);

  useEffect(() => {
    function onDoc(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const q = String(value || "").trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => String(o.label ?? o.value).toLowerCase().includes(q))
    : options;

  function pick(o) {
    onChange(o.value);
    onSelect?.(o);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && filtered[active]) {
        e.preventDefault();
        pick(filtered[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        className="gh-input w-full px-2.5 py-1.5 text-sm"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
      />
      {loading && (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-accent" />
        </span>
      )}
      {open && !disabled && (filtered.length > 0 || q) && (
        <ul className="gh-card absolute z-20 mt-1 max-h-56 w-full overflow-auto py-1 shadow-lg">
          {filtered.length === 0 ? (
            <li className="px-2.5 py-1.5 text-xs text-muted">{emptyText}</li>
          ) : (
            filtered.map((o, i) => (
              <li key={o.value}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(o);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={
                    "flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm " +
                    (i === active ? "bg-subtle" : "hover:bg-subtle")
                  }
                >
                  <span className="truncate text-fg">{o.label ?? o.value}</span>
                  {o.hint && (
                    <span className="shrink-0 text-[11px] text-muted">{o.hint}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
