"use client";
import { useEffect, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import ThemeToggle from "./ThemeToggle";
import OctoscopeMark from "./OctoscopeMark";
import { useNav } from "./NavContext";

export default function TopBar() {
  const { data: session } = useSession();
  const user = session?.user;
  const { breadcrumb, tabs } = useNav();
  const home = breadcrumb[0]?.onClick;

  return (
    <header className="sticky top-0 z-20 bg-header text-headerfg">
      <div className="border-b border-headerborder">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4">
          {home ? (
            <button
              onClick={home}
              className="gh-header-ghost shrink-0 p-0.5"
              aria-label="Home"
            >
              <OctoscopeMark className="h-8 w-8 text-headerfg" />
            </button>
          ) : (
            <OctoscopeMark className="h-8 w-8 shrink-0 text-headerfg" />
          )}

          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 items-center gap-1.5 text-sm"
          >
            {breadcrumb.length === 0 ? (
              <Crumb root>Octoscope</Crumb>
            ) : (
              breadcrumb.map((c, i) => (
                <span key={i} className="flex min-w-0 items-center gap-1.5">
                  {i > 0 && <span className="text-headermuted">/</span>}
                  <Crumb onClick={c.onClick} current={i === breadcrumb.length - 1}>
                    {c.label}
                  </Crumb>
                </span>
              ))
            )}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle variant="header" />
            {user && <UserMenu user={user} />}
          </div>
        </div>
      </div>

      {tabs.length > 0 && <TabBar tabs={tabs} />}
    </header>
  );
}

function TabBar({ tabs }) {
  const refs = useRef([]);

  function onKeyDown(e, i) {
    let next = null;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
    tabs[next]?.onClick?.();
  }

  return (
    <div className="border-b border-border bg-canvas">
      <nav
        role="tablist"
        aria-label="Section"
        className="mx-auto flex max-w-6xl items-center gap-1 px-4"
      >
        {tabs.map((t, i) => (
          <button
            key={i}
            ref={(el) => (refs.current[i] = el)}
            role="tab"
            aria-selected={t.active ? "true" : "false"}
            aria-current={t.active ? "page" : undefined}
            tabIndex={t.active ? 0 : -1}
            className="gh-tab"
            data-active={t.active ? "true" : "false"}
            onClick={t.onClick}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Crumb({ children, onClick, root, current }) {
  const base = "truncate rounded-md px-1.5 py-0.5";
  if (current || (!onClick && !root)) {
    return (
      <span className={`${base} font-semibold text-headerfg`}>{children}</span>
    );
  }
  return (
    <button
      onClick={onClick}
      className={`gh-header-ghost ${base} ${
        root ? "font-semibold" : "text-headermuted"
      }`}
    >
      {children}
    </button>
  );
}

function UserMenu({ user }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="gh-header-ghost flex items-center gap-1 rounded-full p-0.5"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt=""
            className="h-7 w-7 rounded-full ring-1 ring-border"
          />
        ) : (
          <span className="grid h-7 w-7 place-items-center rounded-full bg-fg/10 text-xs">
            {(user.login || user.name || "?").charAt(0).toUpperCase()}
          </span>
        )}
        <svg viewBox="0 0 16 16" className="h-3 w-3 text-headermuted" fill="currentColor">
          <path d="M4.427 6.427a.75.75 0 011.06 0L8 8.94l2.513-2.513a.75.75 0 111.06 1.06l-3.043 3.044a.75.75 0 01-1.06 0L4.427 7.487a.75.75 0 010-1.06z" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-60 overflow-hidden rounded-lg border border-border bg-canvas py-1 text-fg shadow-lg"
        >
          <div className="flex items-center gap-2 px-3 py-2">
            {user.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.image} alt="" className="h-8 w-8 rounded-full" />
            )}
            <div className="min-w-0 text-sm">
              <div className="truncate font-semibold">
                {user.login || user.name}
              </div>
              {user.name && user.login && (
                <div className="truncate text-xs text-muted">{user.name}</div>
              )}
            </div>
          </div>
          <div className="my-1 border-t border-border" />
          <button
            role="menuitem"
            onClick={() => signOut()}
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-subtle"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
