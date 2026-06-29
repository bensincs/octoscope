"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import Modal from "./Modal";

// Promise-based confirm dialog. `const confirm = useConfirm()` then
// `if (await confirm({ title, body, confirmLabel, danger })) { ... }`.
const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback((opts = {}) => {
    return new Promise((resolve) => {
      resolver.current = resolve;
      setState({ confirmLabel: "Confirm", danger: true, ...opts });
    });
  }, []);

  const finish = useCallback((result) => {
    resolver.current?.(result);
    resolver.current = null;
    setState(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => finish(false)}
        title={state?.title || "Are you sure?"}
      >
        {state && (
          <div className="space-y-4">
            {state.body && <p className="text-sm text-muted">{state.body}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => finish(false)}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-subtle hover:text-fg"
              >
                {state.cancelLabel || "Cancel"}
              </button>
              <button
                onClick={() => finish(true)}
                className={
                  state.danger
                    ? "rounded-md border border-danger bg-danger/10 px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/20"
                    : "btn-primary px-3 py-1.5 text-sm"
                }
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return (
    useContext(ConfirmContext) ??
    (async (opts = {}) =>
      typeof window !== "undefined"
        ? window.confirm(opts.body || opts.title || "Are you sure?")
        : false)
  );
}
