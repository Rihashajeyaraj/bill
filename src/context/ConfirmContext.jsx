import React, { createContext, useContext, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";

const ConfirmContext = createContext(null);

const TONES = {
  danger: {
    iconClass: "text-rose-600",
    panelClass: "border-rose-200 bg-rose-50",
    confirmClass: "bg-rose-600 hover:bg-rose-700 text-white"
  },
  warning: {
    iconClass: "text-amber-600",
    panelClass: "border-amber-200 bg-amber-50",
    confirmClass: "bg-amber-600 hover:bg-amber-700 text-white"
  },
  neutral: {
    iconClass: "text-slate-600",
    panelClass: "border-slate-200 bg-white",
    confirmClass: "bg-slate-900 hover:bg-slate-800 text-white"
  }
};

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);

  const confirm = (options) =>
    new Promise((resolve) => {
      setState({
        title: options?.title || "Are you sure?",
        description: options?.description || "This action cannot be undone.",
        confirmText: options?.confirmText || "Confirm",
        cancelText: options?.cancelText || "Cancel",
        tone: options?.tone || "neutral",
        resolve
      });
    });

  function close(result) {
    if (state?.resolve) {
      state.resolve(result);
    }
    setState(null);
  }

  const value = useMemo(() => ({ confirm }), []);
  const tone = TONES[state?.tone] || TONES.neutral;

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {state ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => close(false)} />
          <div className={`relative w-full max-w-md rounded-2xl border p-5 shadow-soft ${tone.panelClass}`}>
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-white/80 p-2">
                <AlertTriangle className={`h-4 w-4 ${tone.iconClass}`} />
              </div>
              <div>
                <p className="text-base font-semibold text-slate-900">{state.title}</p>
                <p className="mt-1 text-sm text-slate-600">{state.description}</p>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => close(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {state.cancelText}
              </button>
              <button
                type="button"
                onClick={() => close(true)}
                className={`rounded-xl px-4 py-2 text-sm font-semibold ${tone.confirmClass}`}
              >
                {state.confirmText}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error("useConfirm must be used within ConfirmProvider");
  return context;
}
