"use client";
import { createContext, useContext, useState } from "react";

// Drives the top bar: a breadcrumb trail (GitHub-style owner / repo) and the
// underline sub-nav tabs shown directly beneath the header.
//   breadcrumb: [{ label, onClick? }]
//   tabs:       [{ label, active?, onClick? }]
const NavContext = createContext(null);

export function NavProvider({ children }) {
  const [breadcrumb, setBreadcrumb] = useState([]);
  const [tabs, setTabs] = useState([]);
  return (
    <NavContext.Provider value={{ breadcrumb, setBreadcrumb, tabs, setTabs }}>
      {children}
    </NavContext.Provider>
  );
}

export function useNav() {
  return (
    useContext(NavContext) ?? {
      breadcrumb: [],
      setBreadcrumb: () => {},
      tabs: [],
      setTabs: () => {},
    }
  );
}
