"use client";
import { useSession } from "next-auth/react";
import TopBar from "@/components/TopBar";
import LoginScreen from "@/components/LoginScreen";

// App chrome shared across every route: the GitHub-style top bar plus the
// auth gate. Authenticated content is whatever the active route renders.
export default function AppShell({ children }) {
  const { status } = useSession();

  return (
    <div className="min-h-full">
      <TopBar />
      {status === "loading" ? (
        <div className="flex items-center justify-center py-32 text-muted">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-accent" />
        </div>
      ) : status === "authenticated" ? (
        children
      ) : (
        <LoginScreen />
      )}
    </div>
  );
}
