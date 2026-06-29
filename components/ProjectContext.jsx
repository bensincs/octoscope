"use client";
import { createContext, useContext } from "react";

// Provides the loaded project (and a reload fn) to the audit + settings pages
// under /projects/[id].
const ProjectContext = createContext(null);

export function ProjectProvider({ value, children }) {
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjectContext() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProjectContext must be used within ProjectProvider");
  return ctx;
}
