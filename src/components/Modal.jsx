import React, { useEffect } from "react";
import { X } from "lucide-react";
import Card from "./Card";
import { UI } from "../theme/tokens";

export default function Modal({ open, title, onClose, children, footer }) {
  useEffect(() => {
    function onEsc(e) {
      if (e.key === "Escape") onClose?.();
    }
    if (open) window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/25" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-semibold text-slate-900">{title}</h3>
              <div className="h-1 w-20 rounded-full mt-2" style={{ background: UI.GRADIENT }} />
            </div>
            <button
              onClick={onClose}
              className="h-9 w-9 rounded-xl border border-slate-100 bg-white hover:bg-slate-50 flex items-center justify-center"
            >
              <X className="h-4 w-4 text-slate-700" />
            </button>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer ? <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/40">{footer}</div> : null}
        </Card>
      </div>
    </div>
  );
}
