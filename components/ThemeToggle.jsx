"use client";
import { useEffect, useState } from "react";
import { SunIcon, MoonIcon } from "@primer/octicons-react";

export default function ThemeToggle({ variant }) {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  }

  const cls =
    variant === "header"
      ? "gh-header-ghost flex h-8 w-8 items-center justify-center"
      : "btn flex h-8 w-8 items-center justify-center";

  return (
    <button
      onClick={toggle}
      className={cls}
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
      aria-label="Toggle theme"
    >
      {dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
    </button>
  );
}
