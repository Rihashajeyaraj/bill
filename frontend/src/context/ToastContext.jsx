import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from "lucide-react";

const ToastContext = createContext(null);

const TONE_MAP = {
  success: {
    icon: CheckCircle2,
    className: "border-emerald-200 bg-emerald-50 text-emerald-800"
  },
  warning: {
    icon: TriangleAlert,
    className: "border-amber-200 bg-amber-50 text-amber-800"
  },
  error: {
    icon: AlertCircle,
    className: "border-rose-200 bg-rose-50 text-rose-800"
  },
  info: {
    icon: Info,
    className: "border-blue-200 bg-blue-50 text-blue-800"
  }
};

function nextId() {
  return `toast_${Date.now().toString(16)}_${Math.floor(Math.random() * 1000)}`;
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    ({ title, description = "", tone = "info", duration = 3200 }) => {
      const id = nextId();
      const entry = {
        id,
        title: title || "Notice",
        description,
        tone,
        duration
      };

      setToasts((prev) => [entry, ...prev].slice(0, 5));
      if (duration > 0) {
        window.setTimeout(() => removeToast(id), duration);
      }
      return id;
    },
    [removeToast]
  );

  const api = useMemo(
    () => ({
      showToast,
      removeToast,
      success: (title, description, duration) =>
        showToast({ title, description, duration, tone: "success" }),
      warning: (title, description, duration) =>
        showToast({ title, description, duration, tone: "warning" }),
      error: (title, description, duration) =>
        showToast({ title, description, duration, tone: "error" }),
      info: (title, description, duration) =>
        showToast({ title, description, duration, tone: "info" })
    }),
    [showToast, removeToast]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[140] flex w-[min(92vw,380px)] flex-col gap-2">
        {toasts.map((toast) => {
          const config = TONE_MAP[toast.tone] || TONE_MAP.info;
          const Icon = config.icon;
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto rounded-2xl border px-3 py-3 shadow-soft backdrop-blur ${config.className}`}
            >
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{toast.title}</p>
                  {toast.description ? (
                    <p className="mt-1 text-xs opacity-90">{toast.description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => removeToast(toast.id)}
                  className="rounded-full p-1 opacity-70 transition hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}
