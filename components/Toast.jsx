"use client";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  CheckCircleFillIcon,
  XCircleFillIcon,
  XIcon,
} from "@primer/octicons-react";

// Minimal toast system. `useToast()` returns { success, error, toast, dismiss }.
const ToastContext = createContext(null);
let nextId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback(
    (id) => setToasts((list) => list.filter((t) => t.id !== id)),
    []
  );

  const push = useCallback(
    (toast) => {
      const id = ++nextId;
      const t = { id, type: "success", duration: 3500, ...toast };
      setToasts((list) => [...list, t]);
      if (t.duration) setTimeout(() => dismiss(id), t.duration);
      return id;
    },
    [dismiss]
  );

  const api = useMemo(
    () => ({
      toast: push,
      success: (message) => push({ type: "success", message }),
      error: (message) => push({ type: "error", message, duration: 6000 }),
      dismiss,
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }) {
  const isError = toast.type === "error";
  return (
    <div
      role="status"
      className={
        "gh-card animate-fadeup pointer-events-auto flex items-start gap-2 px-3 py-2.5 text-sm shadow-lg " +
        (isError ? "border-danger/50" : "border-success/50")
      }
    >
      <span className={isError ? "text-danger" : "text-success"}>
        {isError ? <XCircleFillIcon size={16} /> : <CheckCircleFillIcon size={16} />}
      </span>
      <span className="min-w-0 flex-1 text-fg">{toast.message}</span>
      <button
        onClick={onClose}
        className="rounded p-0.5 text-muted hover:text-fg"
        aria-label="Dismiss"
      >
        <XIcon size={16} />
      </button>
    </div>
  );
}

export function useToast() {
  return (
    useContext(ToastContext) ?? {
      toast: () => {},
      success: () => {},
      error: () => {},
      dismiss: () => {},
    }
  );
}
