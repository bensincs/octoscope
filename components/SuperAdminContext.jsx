"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

// Exposes whether the signed-in user is a platform super admin. Fetched once
// per sign-in from /api/admin/status and shared so both the projects dashboard
// (to show the "Settings" tab) and the /settings page (to guard) can read it.
const Ctx = createContext({ superAdmin: false, loading: true });

export function SuperAdminProvider({ children }) {
  const { status } = useSession();
  const [superAdmin, setSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status !== "authenticated") {
      setSuperAdmin(false);
      setLoading(status === "loading");
      return;
    }
    let alive = true;
    setLoading(true);
    fetch("/api/admin/status")
      .then((r) => (r.ok ? r.json() : { superAdmin: false }))
      .then((d) => alive && setSuperAdmin(!!d.superAdmin))
      .catch(() => alive && setSuperAdmin(false))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [status]);

  return <Ctx.Provider value={{ superAdmin, loading }}>{children}</Ctx.Provider>;
}

export function useSuperAdmin() {
  return useContext(Ctx);
}
